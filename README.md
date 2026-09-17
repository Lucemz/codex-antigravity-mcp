# Codex Antigravity MCP (`codex-antigravity-mcp`)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Version: 1.1.0](https://img.shields.io/badge/version-1.1.0-green.svg)](package.json)
[![Node.js 18+](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](package.json)
[![MCP Protocol](https://img.shields.io/badge/MCP-Model%20Context%20Protocol-purple.svg)](https://modelcontextprotocol.io)

Plugin y servidor MCP para **Codex** (Desktop & CLI) que permite delegar tareas de ingeniería de software, refactorización, auditoría, creación de ramas git y ejecución de tests a **Google Antigravity CLI (`agy`)** como un subagente autónomo persistente potenciado por Gemini.

---

## 🚀 Guía de Instalación y Puesta en Marcha (Paso a Paso)

Sigue estos pasos en orden para dejar el plugin 100% operativo en tu equipo:

### Paso 1: Instalar Node.js en tu equipo
Si aún no tienes Node.js instalado:
- **macOS (Homebrew)**:
  ```sh
  brew install node
  ```
- O descarga el instalador oficial desde [nodejs.org](https://nodejs.org) (versión 18 o superior).

---

### Paso 2: Instalar y Autenticar Google Antigravity CLI (`agy`)
El plugin utiliza la CLI oficial de Antigravity (`agy`) para comunicarse con los modelos de Gemini.

1. Instala `agy` siguiendo la [documentación oficial de Antigravity](https://antigravity.google/docs/cli/reference) o mediante el instalador de Google Gemini.
2. Abre tu **terminal** y ejecuta `agy` para iniciar sesión con tu cuenta de Google:
   ```sh
   # 1. Verifica la versión
   agy --version

   # 2. Inicia sesión interactivamente (solo se hace una vez)
   agy

   # 3. Comprueba que los modelos respondan
   agy models
   ```

> 💡 **Nota:** Si tienes `agy` instalado en una ruta personalizada fuera del estándar, puedes definir `export ANTIGRAVITY_AGY_PATH="/ruta/a/tu/agy"`.

---

### Paso 3: Clonar el Repositorio y Compilar con Node
Antes de activar el plugin en Codex Desktop, descarga el proyecto e instálalo localmente por consola para que se generen los ejecutables y se registre la configuración:

```sh
# 1. Clonar el repositorio
git clone https://github.com/Lucemz/codex-antigravity-mcp.git
cd codex-antigravity-mcp

# 2. Instalar dependencias y compilar
npm install
npm run build

# 3. Registrar el plugin localmente en Codex
npm run install:plugin
```

---

### Paso 4: Activar en Codex Desktop
1. Abre **Codex Desktop**.
2. Ve a la sección **Plugins** / **Marketplace**.
3. Haz clic en **Add Marketplace / Add Repository** (Añadir Marketplace o repositorio).
4. Pega la URL del repositorio:
   ```text
   https://github.com/Lucemz/codex-antigravity-mcp
   ```
5. Haz clic en **Instalar / Install**.
6. **Reinicia Codex Desktop (`Cmd + Q`)** o abre un **Nuevo Chat** para que las herramientas MCP se carguen en la sesión.

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
- `mode`:
  - `"plan"`: Inspección y análisis en solo lectura (sin modificar archivos).
  - `"accept-edits"`: Autorización completa para escribir archivos, crear ramas git y correr comandos.
- `skipPermissions`: `true` (por defecto) para ejecución autónoma sin bloqueos interactivos.
- `subagents`: `"auto"` (por defecto), `"required"`, o `"off"`.
- `model`: ID opcional del modelo Gemini (ej. `gemini-3.7-flash-medium`, `gemini-3.8-flash-high`, `gemini-3.1-pro-high`).

---

## 💡 Ejemplos de Uso desde Codex

En cualquier conversación de Codex, puedes invocar al plugin escribiendo:

### 1. Verificar Estado y Conexión
```text
@Codex Antigravity ejecuta antigravity_status y dime qué modelos de Gemini están disponibles.
```

### 2. Desarrollo Completo, Ramas y Tests (`accept-edits`)
```text
@Codex Antigravity en /Users/usuario/proyectos/mi-app:
Crea una sesión persistente en mode "accept-edits".
1. Crea una rama git 'feature/nueva-funcionalidad'.
2. Implementa los cambios solicitados en el código.
3. Ejecuta los tests del proyecto.
4. Si los tests pasan, haz commit y reporta el diff final.
```

### 3. Auditoría Arquitectónica y Revisión (`plan`)
```text
@Codex Antigravity en /Users/usuario/proyectos/mi-app:
Crea una sesión en mode "plan".
Analiza la arquitectura del proyecto, detecta posibles mejoras y genera un plan estructurado sin modificar archivos.
```

---

## ❓ Preguntas Frecuentes (FAQ / Troubleshooting)

### 1. ¿Por qué me sale `antigravity_... undefined` o no veo las herramientas?
- **Solución:** En Codex Desktop, las herramientas MCP se cargan al iniciar una nueva conversación. Cierra la conversación actual y abre un **Nuevo Chat**, o reinicia la aplicación completamente con `Cmd + Q`.

### 2. ¿Qué hacer si sale `agy was not found` o error de autenticación?
- **Solución:** Abre tu terminal y corre `agy`. Si no has iniciado sesión en Google, el comando te guiará interactivamente para autenticar tu cuenta.

---

## 🧪 Pruebas Automatizadas (Tests)

El repositorio incluye pruebas unitarias para validar timeouts, heartbeats de inactividad y recuperación de respuestas:

```sh
npm test
```

---

## 📄 Licencia

Este proyecto es código abierto bajo la licencia [MIT](LICENSE).
