# 🔥 Gas Meter — Lectura automática del contador Redexis

Automatiza el envío mensual de la lectura del contador de gas a Redexis.

## Flujo

1. Dejas la foto del contador en la carpeta `photos/` (o en Google Drive)
2. El script extrae la lectura en m³ con Claude Vision
3. Navega a Redexis, rellena el formulario y adjunta la foto
4. Pide confirmación antes de enviar (en local) o envía automáticamente (en CI)

El GitHub Action lo ejecuta automáticamente **el día 15 de cada mes a las 10:00 hora española**.

---

## Instalación local

```bash
# 1. Instalar dependencias
npm install

# 2. Instalar Chromium
npm run install:browsers

# 3. Configurar variables de entorno
cp .env.example .env
# Edita .env con tu ANTHROPIC_API_KEY y tus datos
```

## Uso local

```bash
# Deja la foto del contador en ./photos/ y ejecuta:
npm run submit
```

---

## Configuración en GitHub Actions (ejecución automática)

### 1. Secrets de GitHub

Ve a tu repo → Settings → Secrets and variables → Actions → New repository secret:

| Secret | Valor |
|--------|-------|
| `ANTHROPIC_API_KEY` | Tu API key de Anthropic |
| `NIF` | Tu NIF |
| `CUPS` | Tu CUPS |
| `NUMERO_CONTADOR` | Nº de contador |
| `GDRIVE_FOLDER_ID` | ID de la carpeta de Google Drive con las fotos |
| `GDRIVE_SERVICE_ACCOUNT_JSON` | JSON completo de la Service Account de Google |

### 2. Configurar Google Drive

Para que el workflow pueda descargar la foto:

1. Ve a [Google Cloud Console](https://console.cloud.google.com)
2. Crea un proyecto → Activa la API de Google Drive
3. Crea una **Service Account** y descarga el JSON de credenciales
4. Comparte la carpeta de Drive con el email de la Service Account (solo lectura)
5. Copia el ID de la carpeta (parte de la URL de Drive) como secret `GDRIVE_FOLDER_ID`
6. Copia el contenido del JSON como secret `GDRIVE_SERVICE_ACCOUNT_JSON`

### 3. Lanzar manualmente

En cualquier momento puedes lanzarlo desde GitHub → Actions → Gas Meter → Run workflow.

---

## Estructura

```
gas-meter/
├── .env.example              # Plantilla de variables de entorno
├── .github/
│   └── workflows/
│       └── gas-meter.yml     # GitHub Action (día 15 de cada mes)
├── scripts/
│   └── download_photo.py     # Descarga la foto desde Google Drive (CI)
├── photos/                   # Carpeta local para las fotos (ignorada en git)
├── submit_reading.ts          # Script principal
├── package.json
└── tsconfig.json
```
