import pathlib

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from modal import App, Image, Secret, Volume
import sqlite3
import sqlite_vec
import struct
from typing import List


#Discord CONSTANTS
DEFAULT_LIMIT = 50

# DB CONSTANTS
DB_FILENAME = "discord_messages.db"
VOLUME_DIR = "/cache-vol"
DB_PATH = pathlib.Path(VOLUME_DIR, DB_FILENAME)

#CHROMA CONSTANTS
# CHROMA_DIR = "chroma"
# CHROMA_PATH = pathlib.Path(VOLUME_DIR, CHROMA_DIR)


#SQLITE CONSTANTS
# SQLITE_VERSION = "3420000"  # e.g. 3.42.0 => "3420000" on sqlite.org
# SQLITE_TARBALL = f"sqlite-autoconf-{SQLITE_VERSION}.tar.gz"
# SQLITE_URL = f"https://www.sqlite.org/2023/{SQLITE_TARBALL}"

# Example of building a custom image
# custom_image = (
#     Image.debian_slim(python_version="3.12")
#     # 1) Install build tools
#     .run_commands(
#         [
#             "apt-get update && apt-get install -y build-essential wget ca-certificates",
#             "rm -rf /var/lib/apt/lists/*"
#         ]
#     )
#     # 2) Download + compile SQLite from source
#     .run_commands(
#         [
#             f"wget {SQLITE_URL}",
#             f"tar xvfz {SQLITE_TARBALL}",
#             f"cd sqlite-autoconf-{SQLITE_VERSION} && ./configure --prefix=/usr/local && make && make install",
#             "ldconfig",  # refresh shared library cache
#         ]
#     )
#     # 3) Now that we have a new libsqlite3, let's install our Python deps
#     .pip_install_from_pyproject("pyproject.toml")
# )

volume = Volume.from_name("sqlite-db-vol", create_if_missing=True)
image = Image.debian_slim().pip_install_from_pyproject("pyproject.toml")

secrets = Secret.from_dotenv()

app = App(name="starter_template", secrets=[secrets], image=image)

# Create a FastAPI instance here so it can be shared across modules
fastapi_app = FastAPI()

# Configure CORS
fastapi_app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],  # Add your frontend URL
    allow_credentials=True,
    allow_methods=["*"],  # Allows all methods
    allow_headers=["*"],  # Allows all headers
)


def serialize(vector: List[float]) -> bytes:
    """Serializes a list of floats into a compact 'raw bytes' format."""
    return struct.pack(f"{len(vector)}f", *vector)

def get_db_conn(db_path):
    conn = sqlite3.connect(DB_PATH)
    sqlite_vec.load(conn)
    return conn
