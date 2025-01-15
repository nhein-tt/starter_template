import sqlite3
import os


from .discord import DEFAULT_LIMIT
from modal import asgi_app
from openai import OpenAI
from .discord import scrape_discord_server
import sqlite_vec
from sqlite_vec import serialize_float32

from .common import DB_PATH, VOLUME_DIR, app, fastapi_app, get_db_conn, serialize, volume


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

@fastapi_app.get("/query/{message}")
async def similarity_search(message: str, top_k: int = 15):
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

    return results


@fastapi_app.get("/")
def read_root():
    return {"message": "Hello World"}
