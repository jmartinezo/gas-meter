"""
Descarga la foto más reciente de una carpeta de Google Drive.
Usado en el workflow de GitHub Actions.

Requiere:
  - Variable de entorno GDRIVE_FOLDER_ID: ID de la carpeta de Drive
  - Archivo /tmp/sa.json: credenciales de Service Account con acceso a la carpeta
"""

import os
import json
import sys
from pathlib import Path
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload
import io

SCOPES = ["https://www.googleapis.com/auth/drive.readonly"]
PHOTOS_DIR = Path("./photos")
PHOTO_MIME_TYPES = [
    "image/jpeg",
    "image/png",
    "image/webp",
]


def main():
    folder_id = os.environ.get("GDRIVE_FOLDER_ID")
    sa_path = "/tmp/sa.json"

    if not folder_id:
        print("❌ GDRIVE_FOLDER_ID no está definido")
        sys.exit(1)

    if not Path(sa_path).exists():
        print("❌ No se encontró el archivo de credenciales /tmp/sa.json")
        sys.exit(1)

    creds = service_account.Credentials.from_service_account_file(
        sa_path, scopes=SCOPES
    )
    service = build("drive", "v3", credentials=creds, cache_discovery=False)

    # Buscar la foto más reciente en la carpeta
    mime_query = " or ".join(f"mimeType='{m}'" for m in PHOTO_MIME_TYPES)
    results = (
        service.files()
        .list(
            q=f"'{folder_id}' in parents and ({mime_query}) and trashed=false",
            orderBy="modifiedTime desc",
            pageSize=1,
            fields="files(id, name, mimeType)",
        )
        .execute()
    )

    files = results.get("files", [])
    if not files:
        print("❌ No se encontraron fotos en la carpeta de Google Drive")
        sys.exit(1)

    file_info = files[0]
    print(f"📷 Descargando: {file_info['name']}")

    PHOTOS_DIR.mkdir(parents=True, exist_ok=True)
    dest = PHOTOS_DIR / file_info["name"]

    request = service.files().get_media(fileId=file_info["id"])
    with io.FileIO(dest, "wb") as fh:
        downloader = MediaIoBaseDownload(fh, request)
        done = False
        while not done:
            _, done = downloader.next_chunk()

    print(f"✅ Foto guardada en {dest}")


if __name__ == "__main__":
    main()
