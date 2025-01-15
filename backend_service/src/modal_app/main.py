import sqlite3
import os
import json

from .discord import DEFAULT_LIMIT
from modal import asgi_app
from openai import OpenAI
from .discord import scrape_discord_server
import sqlite_vec
from sqlite_vec import serialize_float32
from fastapi import Request

from .common import DB_PATH, VOLUME_DIR, app, fastapi_app, get_db_conn, serialize, volume, TOOLS


@app.function(
    volumes={VOLUME_DIR: volume},
)
def init_db():
    """Initialize the SQLite database with a simple table."""
    volume.reload()
    conn = sqlite3.connect(DB_PATH)
    conn.enable_load_extension(True)
    sqlite_vec.load(conn)
    conn.enable_load_extension(False)
    cursor = conn.cursor()

    # Create a simple table
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS discord_messages (
                    id TEXT PRIMARY KEY,
                    channel_id TEXT NOT NULL,
                    author_id TEXT NOT NULL,
                    content TEXT NOT NULL,
                    created_at TIMESTAMP NOT NULL
                )
        """
    )
    cursor.execute(
        """
        CREATE VIRTUAL TABLE IF NOT EXISTS vec_discord_messages USING vec0(
            id TEXT PRIMARY KEY,
            embedding FLOAT[1536]
        );
        """
    )

    conn.commit()
    conn.close()
    volume.commit()


@app.function(
    volumes={VOLUME_DIR: volume},
    timeout=900 # 15 min timeout
)
@asgi_app()
def fastapi_entrypoint():
    # Initialize database on startup
    init_db.remote()
    return fastapi_app


@fastapi_app.post("/ask")
async def ask_discord(request: Request):
    """
    This endpoint uses OpenAI function calling to decide if we should:
    1) Do RAG (similarity search)
    2) Generate & execute SQL
    to answer the user’s question.
    """
    client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
    body = await request.json()
    user_query = body.get("query", "")

    if not user_query:
        return {"error": "No query provided."}

    # The system message can instruct the model how to decide.
    system_message = {
        "role": "system",
        "content":
            """
            You are a helpful assistant. You can answer user questions using either:\n\n
            1) RAG-based similarity search (when the user wants summarized info from the actual conversation content), OR\n
            2) Generating a SQL query if the user wants structured data queries.\n\n
            Please do not mix them. Decide which approach is best for the user's question.\n
            If you choose SQL, provide a valid SQL SELECT statement that references the 'discord_messages' table.\n
            here is the schema for the `discord_messages` table that we have:\n
            discord_messages (
                        id TEXT PRIMARY KEY,
                        channel_id TEXT NOT NULL,
                        author_id TEXT NOT NULL,
                        content TEXT NOT NULL,
                        created_at TIMESTAMP NOT NULL
                    )
            """
    }

    user_message = {
        "role": "user",
        "content": user_query
    }
    messages = [system_message, user_message]

    # 1) Ask the model to call our function
    completion = client.chat.completions.create(
        model="gpt-4o",
        messages=messages,
        tools=TOOLS,
        tool_choice={"type": "function", "function": {"name": "decide_approach"}}
    )
    completion_message = completion.choices[0].message
    messages.append(completion_message)
    tool_calls = completion_message.tool_calls
    # 2) Parse the function call
    if not tool_calls:
        return {
            "answer": "No function call was produced by the LLM. Could not proceed."
        }
    for tool_call in tool_calls:
        fn_name = tool_call.function.name
        fn_args = json.loads(tool_call.function.arguments)
        approach = fn_args.get("approach", "rag")
        print(f"approach: {approach}")

        # 3) If approach == 'rag', do the existing similarity_search
        if approach == "rag":
            rag_data = similarity_search(user_query)
            messages.append(
                {
                    "tool_call_id": tool_call.id,
                    "role": "tool",
                    "name": fn_name,
                    "content": str(rag_data),
                }
            )
            final_response = client.chat.completions.create(
                model="gpt-4o",
                messages=messages,
            )
            messages.append(final_response.choices[0].message)
            return {
                "answer": final_response.choices[0].message.content,
                "chat_history": messages
            }

        # 4) If approach == 'sql', let's run the sql_query
        elif approach == "sql":
            sql_query = fn_args.get("sql_query", "")
            if not sql_query.strip():
                return {"answer": "No SQL query provided by LLM."}

            # Attempt to run it
            sql_data = do_sql_query(sql_query)
            messages.append(
                {
                    "tool_call_id": tool_call.id,
                    "role": "tool",
                    "name": fn_name,
                    "content": str(sql_data),
                }
            )
            final_response = client.chat.completions.create(
                model="gpt-4o",
                messages=messages,
            )
            messages.append(final_response.choices[0].message)
            return {
                "answer": final_response.choices[0].message.content,
                "chat_history": messages,
            }



        else:
            return {"answer": "Unknown approach returned by LLM."}


@fastapi_app.post("/discord/{guild_id}")
async def scrape_server(guild_id: str, limit: int = DEFAULT_LIMIT):
    discord_token = os.environ["DISCORD_TOKEN"]
    headers = {
        "Authorization": discord_token,
        "Content-Type": "application/json"
    }
    volume.reload()
    scrape_discord_server(guild_id, headers, limit)
    volume.commit()
    return {"status": "ok", "message": f"Scraped guild_id={guild_id}, limit={limit}"}

# @fastapi_app.get("/query/{message}")
def similarity_search(message: str, top_k: int = 15):
    client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
    conn = get_db_conn(DB_PATH)
    cursor = conn.cursor()
    query_vec = client.embeddings.create(model="text-embedding-ada-002", input=message).data[0].embedding
    query_bytes = serialize(query_vec)

    results = cursor.execute(
            """
            SELECT
                vec_discord_messages.id,
                distance,
                discord_messages.channel_id,
                discord_messages.author_id,
                discord_messages.content,
                discord_messages.created_at
            FROM vec_discord_messages
            LEFT JOIN discord_messages USING (id)
            WHERE embedding MATCH ?
              AND k = ?
            ORDER BY distance
            """,
            [query_bytes, top_k],
        ).fetchall()
    conn.close()

    return results


def do_sql_query(sql_query: str):
    """
    Executes the generated SQL and returns the rows.
    """
    print(f"sql query generated: {sql_query}")
    from .common import get_db_conn
    conn = get_db_conn(DB_PATH)
    cursor = conn.cursor()

    try:
        rows = cursor.execute(sql_query).fetchall()
        conn.close()
        return {
            "answer": f"SQL Query Results: {rows}",
            "approach": "sql",
            "sql_query": sql_query,
        }
    except Exception as e:
        return {
            "error": str(e),
            "approach": "sql",
            "sql_query": sql_query
        }

@fastapi_app.get("/")
def read_root():
    return {"message": "Hello World"}
