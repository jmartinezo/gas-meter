import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import Anthropic from "@anthropic-ai/sdk";
import { chromium } from "@playwright/test";
import * as dotenv from "dotenv";

dotenv.config();

// ─── Config ──────────────────────────────────────────────────────────────────

const REDEXIS_URL =
  "https://www.redexis.es/mi-gas/lectura-de-mi-contador/lectura-del-contador";

const NIF = process.env.NIF!;
const CUPS = process.env.CUPS!;
const NUMERO_CONTADOR = process.env.NUMERO_CONTADOR!;
const PHOTOS_DIR = process.env.PHOTOS_DIR || "./photos";
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY!;

// ─── IDs reales del formulario de Redexis (inspeccionados abril 2025) ────────
//
//   #edit-no-identificacion-fiscal    -> NIF
//   #edit-cups                        -> CUPS  (se autocompleta tras blur en NIF)
//   #edit-gas-meter                   -> N Contador (idem)
//   #edit-reading-meter               -> Lectura (m3)
//   input[name="files[attach_image]"] -> Input de fichero (foto)
//   #edit-accept-privacy-policy       -> Checkbox privacidad
//   #edit-actions-submit              -> Boton "Enviar lectura"
//
//   La web usa reCAPTCHA v3 (invisible). El token se genera automaticamente
//   al cargar la pagina como campo oculto; Playwright no necesita hacer nada.

// ─── Helpers ─────────────────────────────────────────────────────────────────

function validateEnv() {
  const required = ["ANTHROPIC_API_KEY", "NIF", "CUPS", "NUMERO_CONTADOR"];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(
      `Faltan variables de entorno: ${missing.join(", ")}\nCopia .env.example a .env y rellena los valores.`
    );
  }
}

function getLatestPhoto(dir: string): string {
  const absDir = path.resolve(dir);
  if (!fs.existsSync(absDir)) {
    throw new Error(`La carpeta de fotos no existe: ${absDir}`);
  }

  const extensions = [".jpg", ".jpeg", ".png", ".webp"];
  const files = fs
    .readdirSync(absDir)
    .filter((f) => extensions.includes(path.extname(f).toLowerCase()))
    .map((f) => ({
      name: f,
      mtime: fs.statSync(path.join(absDir, f)).mtime.getTime(),
    }))
    .sort((a, b) => b.mtime - a.mtime);

  if (files.length === 0) {
    throw new Error(
      `No se encontraron fotos en ${absDir}.\nDeja la foto del contador en esa carpeta e intentalo de nuevo.`
    );
  }

  const latest = path.join(absDir, files[0].name);
  console.log(`Foto seleccionada: ${files[0].name}`);
  return latest;
}

async function extractReadingFromPhoto(photoPath: string): Promise<string> {
  console.log("Extrayendo lectura del contador con Claude Vision...");

  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  const imageBuffer = fs.readFileSync(photoPath);
  const base64Image = imageBuffer.toString("base64");
  const ext = path.extname(photoPath).toLowerCase();
  const mediaTypeMap: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
  };
  const mediaType = mediaTypeMap[ext] || "image/jpeg";

  const response = await client.messages.create({
    model: "claude-opus-4-5",
    max_tokens: 256,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: mediaType as
                | "image/jpeg"
                | "image/png"
                | "image/webp"
                | "image/gif",
              data: base64Image,
            },
          },
          {
            type: "text",
            text: [
              "Eres un sistema de lectura de contadores de gas.",
              "Analiza la imagen del contador de gas y extrae el valor de la lectura en m3.",
              "Responde UNICAMENTE con el numero, sin unidades, sin texto adicional, sin puntos de miles.",
              "Usa punto decimal si hay decimales.",
              "Ejemplo de respuesta valida: 1234 o 1234.5",
            ].join("\n"),
          },
        ],
      },
    ],
  });

  const reading = (response.content[0] as { type: string; text: string }).text
    .trim()
    .replace(",", ".");

  if (!/^\d+(\.\d+)?$/.test(reading)) {
    throw new Error(
      `La lectura extraida no parece un numero valido: "${reading}"\nRevisa la foto e intentalo de nuevo.`
    );
  }

  return reading;
}

async function confirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "s");
    });
  });
}

async function submitReading(photoPath: string, reading: string) {
  console.log("\nAbriendo navegador...");

  const browser = await chromium.launch({ headless: false, slowMo: 300 });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log("Navegando a Redexis...");
    await page.goto(REDEXIS_URL, { waitUntil: "networkidle", timeout: 30000 });

    // Aceptar cookies si aparece el banner
    try {
      const cookieBtn = page.locator(
        "#onetrust-accept-btn-handler, button:has-text('Aceptar todas'), button:has-text('Aceptar')"
      );
      await cookieBtn.first().click({ timeout: 5000 });
      console.log("Cookies aceptadas");
      await page.waitForTimeout(1000);
    } catch {
      // No hay banner de cookies, continuamos
    }

    // ── Paso 1: NIF ───────────────────────────────────────────────────────────
    console.log("Introduciendo NIF...");
    const nifInput = page.locator("#edit-no-identificacion-fiscal");
    await nifInput.fill(NIF);

    // Tab para disparar el evento blur y el posible autocompletado AJAX
    await nifInput.press("Tab");

    // ── Paso 2: Esperar posible autocompletado de CUPS y Contador ────────────
    console.log("Esperando autocompletado de CUPS y Numero de Contador...");
    let cupsAutoFilled = false;
    try {
      await page.waitForFunction(
        () => {
          const cups = document.getElementById("edit-cups") as HTMLInputElement;
          const cont = document.getElementById("edit-gas-meter") as HTMLInputElement;
          return (cups?.value?.length ?? 0) > 0 && (cont?.value?.length ?? 0) > 0;
        },
        { timeout: 5000 }
      );
      cupsAutoFilled = true;
      console.log("Campos autocompletados por la web");
    } catch {
      console.log("Sin autocompletado detectado, rellenando manualmente...");
    }

    // ── Paso 3: CUPS ──────────────────────────────────────────────────────────
    const cupsInput = page.locator("#edit-cups");
    if (cupsAutoFilled) {
      const autoFilledCups = await cupsInput.inputValue();
      if (autoFilledCups !== CUPS) {
        console.warn(
          `CUPS autocompletado (${autoFilledCups}) difiere del configurado. Corrigiendo...`
        );
        await cupsInput.fill(CUPS);
      }
    } else {
      await cupsInput.fill(CUPS);
    }

    // ── Paso 4: N Contador ────────────────────────────────────────────────────
    const contadorInput = page.locator("#edit-gas-meter");
    if (cupsAutoFilled) {
      const autoFilledContador = await contadorInput.inputValue();
      if (autoFilledContador !== NUMERO_CONTADOR) {
        console.warn(
          `Numero de contador autocompletado (${autoFilledContador}) difiere del configurado. Corrigiendo...`
        );
        await contadorInput.fill(NUMERO_CONTADOR);
      }
    } else {
      await contadorInput.fill(NUMERO_CONTADOR);
    }

    // ── Paso 5: Lectura en m3 ─────────────────────────────────────────────────
    await page.locator("#edit-reading-meter").fill(reading);
    console.log(`Lectura introducida: ${reading} m3`);

    // ── Paso 6: Adjuntar foto ─────────────────────────────────────────────────
    const fileInput = page.locator("input[name='files[attach_image]']");
    await fileInput.setInputFiles(photoPath);
    console.log("Foto adjuntada");

    // Esperar a que el servidor confirme la subida del fichero
    await page.waitForTimeout(2000);

    // ── Paso 7: Politica de privacidad ────────────────────────────────────────
    await page.locator("#edit-accept-privacy-policy").check();
    console.log("Politica de privacidad aceptada");

    // Screenshot para revisar antes de enviar
    await page.screenshot({ path: "/tmp/redexis_preview.png" });
    console.log("\nScreenshot del formulario guardado en /tmp/redexis_preview.png");

    // ── Paso 8: Confirmacion ──────────────────────────────────────────────────
    const ok = await confirm(
      `\nCONFIRMACION REQUERIDA\nLectura extraida: ${reading} m3\nEnviar la lectura? (s/N): `
    );

    if (!ok) {
      console.log("Envio cancelado por el usuario.");
      return;
    }

    // ── Paso 9: Enviar ────────────────────────────────────────────────────────
    await page.locator("#edit-actions-submit").click();
    console.log("Lectura enviada");

    await page.waitForTimeout(4000);
    await page.screenshot({ path: "/tmp/redexis_result.png" });
    console.log("Proceso completado. Screenshot en /tmp/redexis_result.png");
  } finally {
    await browser.close();
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("==========================================");
  console.log("  Gas Meter - Lectura automatica Redexis  ");
  console.log("==========================================\n");

  validateEnv();

  const photoPath = getLatestPhoto(PHOTOS_DIR);
  const reading = await extractReadingFromPhoto(photoPath);

  console.log(`\nLectura extraida: ${reading} m3`);

  await submitReading(photoPath, reading);
}

main().catch((err) => {
  console.error("\nError:", err.message);
  process.exit(1);
});