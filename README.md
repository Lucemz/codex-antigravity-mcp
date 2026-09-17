# Codex Antigravity MCP (`codex-antigravity-mcp`)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Version: 1.1.0](https://img.shields.io/badge/version-1.1.0-green.svg)](package.json)
[![Node.js 18+](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](package.json)
[![MCP Protocol](https://img.shields.io/badge/MCP-Model%20Context%20Protocol-purple.svg)](https://modelcontextprotocol.io)

Plugin y servidor MCP Plug-and-Play para **Codex** (Desktop & CLI) que permite delegar tareas de ingeniería, refactorización, auditoría y ejecución de tests a **Google Antigravity CLI (`agy`)** como un subagente autónomo persistente potenciado por Gemini.

---

## ⚡ Plug and Play (100% Zero-Config)

A partir de la versión **v1.1.0**, el plugin incluye un launcher universal (`bin/run.sh`) que:
- 🔍 **Auto-detecta Node.js**: Encuentra Node automáticamente en Homebrew (`/opt/homebrew`, `/usr/local`), NVM (`~/.nvm`), fnm, Volta, asdf, mise, pnpm o Bun. No requiere configurar variables de entorno en apps de escritorio de Codex.
- 🎯 **Auto-detecta Antigravity (`agy`)**: Escanea rutas estándar (`/opt/homebrew/bin`, `~/.gemini/antigravity/bin`, `~/.gemini/antigravity-cli/bin`, `/Applications/Antigravity.app`, etc.).
- 📦 **Instalación Directa desde el Marketplace de Codex**: Agrega el repositorio de GitHub y el plugin quedará listo para usar al instante.

---

## 📋 Requisitos Previos (Prerequisites)

Para utilizar este plugin necesitas tener instalado **Google Antigravity CLI (`agy`)** en tu equipo:

### 1. Descargar e Instalar Antigravity CLI / Gemini CLI
Si aún no lo tienes instalado:
- Sigue la guía oficial de instalación de Google Antigravity CLI: [Google Antigravity Docs](https://antigravity.google/docs/cli/reference)
- O instala mediante tu gestor de paquetes / instalador de Google Gemini.

### 2. Autenticar Antigravity CLI
Abre tu terminal y ejecuta una sola vez:
```sh
# Verifica que agy esté instalado
agy --version

# Inicia sesión interactivamente con tu cuenta de Google
agy

# Comprueba que los modelos estén disponibles
agy models
```

> **Nota:** Si instalaste `agy` en una ruta personalizada fuera del estándar, puedes definir `export ANTIGRAVITY_AGY_PATH="/ruta/personalizada/agy"`.

---

## 🚀 Instalación en Codex (Installation)

### Método 1: Desde el Marketplace de Plugins de Codex (Recomendado)

1. Abre **Codex Desktop**.
2. Ve a la sección **Plugins** o **Marketplace**.
3. Selecciona **Add Marketplace / Add Repository** (Añadir Marketplace o repositorio).
4. Pega la URL del repositorio:
   ```text
   https://github.com/Lucemz/codex-antigravity-mcp
   ```
5. Instala el plugin **Codex Antigravity**. ¡Listo!

---

### Método 2: Instalación Local / Desarrollador

Si deseas clonar o compilar desde el código fuente:

```sh
# 1. Clonar el repositorio
git clone https://github.com/Lucemz/codex-antigravity-mcp.git
cd codex-antigravity-mcp

# 2. Instalar dependencias y compilar
npm install
npm test
npm run build

# 3. Desplegar a tu carpeta local de plugins (~/plugins/codex-antigravity)
npm run install:plugin
```

---

## 🛠️ Herramientas MCP Disponibles (MCP Tools)

| Herramienta | Descripción |
| :--- | :--- |
| `antigravity_status` | Comprueba la disponibilidad de `agy`, modelos Gemini activos, estado de autenticación y límites. |
| `antigravity_session_create` | Inicia una sesión multi-turno persistente en el directorio de trabajo (`cwd`). |
| `antigravity_session_prompt` | Envía un prompt a una sesión persistente activa y espera la respuesta estructurada. |
| `antigravity_session_list` | Lista las sesiones activas, su estado (`idle`/`running`) y turnos en cola. |
| `antigravity_session_close` | Cierra y libera los procesos de una sesión persistente. |
| `antigravity_run` | Ejecuta un turno aislado en Antigravity y cierra la sesión automáticamente. |

### Parámetros Principales:
- `mode`: `"plan"` (inspección y análisis en solo lectura) o `"accept-edits"` (autorización para editar archivos, crear ramas git y correr comandos).
- `skipPermissions`: `true` (por defecto) para ejecución autónoma sin bloqueos interactivos.
- `subagents`: `"auto"` (por defecto), `"required"`, o `"off"`.
- `model`: ID opcional del modelo Gemini (ej. `gemini-3.7-flash-medium`, `gemini-3.8-flash-high`, `gemini-3.1-pro-high`).

---

## 💡 Ejemplos de Uso desde Codex

En Codex, simplemente menciona `@Codex Antigravity` o pídele que use las herramientas de Antigravity:

### 1. Desarrollo Completo, Ramas y Tests (`accept-edits`)
```text
@Codex Antigravity en /Users/usuario/proyectos/mi-app:
Crea una sesión persistente en mode "accept-edits".
1. Crea una rama git 'feature/nueva-funcionalidad'.
2. Implementa los cambios solicitados en el código.
3. Ejecuta los tests del proyecto.
4. Si los tests pasan, haz commit y reporta el diff final.
```

### 2. Auditoría Arquitectónica y Revisión (`plan`)
```text
@Codex Antigravity en /Users/usuario/proyectos/mi-app:
Crea una sesión en mode "plan".
Analiza la arquitectura del proyecto, detecta posibles mejoras y genera un plan estructurado.
```

---

## 🧪 Pruebas Unitarias (Tests)

El proyecto incluye 13 suites de pruebas unitarias automatizadas:

```sh
npm test
```

---

## 📄 Licencia (License)

Este proyecto es código abierto bajo la licencia [MIT](LICENSE).
