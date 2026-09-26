import { Linter } from 'eslint'
import { dirname, isAbsolute, relative, resolve } from 'node:path'

// Resolve actual imports relative to their file, not folder names inside strings.
export function findExternalImports(source, file, root) {
  const outside = []
  const linter = new Linter()
  const messages = linter.verify(source, [{
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { imports: { rules: { boundary: { create() {
      const check = node => {
        const value = node?.type === 'Literal' ? node.value : null
        if (typeof value !== 'string') return
        if (/^(?:file:|[A-Za-z]:[\\/])/.test(value)) { outside.push(value); return }
        if (!value.startsWith('.')) return
        const target = resolve(dirname(resolve(root, file)), value)
        const within = relative(resolve(root), target).replaceAll('\\', '/')
        if (within === '..' || within.startsWith('../') || isAbsolute(within)) outside.push(value)
      }
      return {
        ImportDeclaration: node => check(node.source),
        ExportNamedDeclaration: node => check(node.source),
        ExportAllDeclaration: node => check(node.source),
        ImportExpression: node => check(node.source),
        CallExpression: node => { if (node.callee.type === 'Identifier' && node.callee.name === 'require') check(node.arguments[0]) },
      }
    } } } } },
    rules: { 'imports/boundary': 'error' },
  }])
  const parseErrors = messages.filter(message => message.fatal)
  if (parseErrors.length) throw new Error(parseErrors.map(message => `${message.line}:${message.column} ${message.message}`).join('\n'))
  return [...new Set(outside)]
}

const GLYPHS = ['\u26a0\ufe0f', '\u2728', '\ud83c\udfe2', '\ud83d\udccd', '\ud83c\udfe6', '\ud83d\udcf1', '\ud83d\udcb5', '\ud83c\udf10', '\ud83d\udccb', '\ud83d\udcb3', '\ud83c\udfad', '\ud83d\udc77', '\u2694\ufe0f']
const DIALOGS = new Set(['confirm', 'alert', 'prompt'])

function stringValues(node) {
  if (!node) return []
  if (node.type === 'Literal' && typeof node.value === 'string') return [node.value]
  if (node.type === 'TemplateLiteral') return [...node.quasis.map(part => part.value.cooked ?? ''), ...node.expressions.flatMap(stringValues)]
  if (node.type === 'ConditionalExpression') return [...stringValues(node.consequent), ...stringValues(node.alternate)]
  if (node.type === 'LogicalExpression' || node.type === 'BinaryExpression') return [...stringValues(node.left), ...stringValues(node.right)]
  if (node.type === 'JSXExpressionContainer') return stringValues(node.expression)
  return []
}

function attribute(node, name) {
  return node.attributes?.find(attr => attr.type === 'JSXAttribute' && attr.name.name === name)
}

function classes(node) {
  return stringValues(attribute(node, 'className')?.value).join(' ').split(/\s+/).filter(Boolean)
}

function height(token) {
  const match = /^(?:min-)?h-(\d+(?:\.\d+)?|\[(\d+(?:\.\d+)?)(px|rem)\])$/.exec(token)
  if (!match) return null
  return match[2] ? Number(match[2]) * (match[3] === 'rem' ? 16 : 1) : Number(match[1]) * 4
}

function localContainment(node) {
  const tokens = classes(node)
  return tokens.some(token => ['pointer-events-none', 'max-w-full', 'overflow-x-auto'].includes(token)) || node.name?.name === 'HorizontalScroll'
}

export function inspectResponsiveJsx(source) {
  const result = { nativeDialogs: [], glyphs: [], undersizedControls: [], fixedWidths: [], controls: [] }
  const linter = new Linter()
  const messages = linter.verify(source, [{
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: {
      quality: {
        rules: {
          responsive: {
            create(context) {
              function globalIdentifier(node) {
                let scope = context.sourceCode.getScope(node)
                while (scope) {
                  const variable = scope.set.get(node.name)
                  if (variable) return variable.defs.length === 0
                  scope = scope.upper
                }
                return true
              }
              function dialogCall(callee) {
                if (callee.type === 'ChainExpression') return dialogCall(callee.expression)
                if (callee.type === 'Identifier') return DIALOGS.has(callee.name) && globalIdentifier(callee)
                if (callee.type !== 'MemberExpression') return false
                const name = callee.computed ? callee.property.value : callee.property.name
                return DIALOGS.has(name) && callee.object.type === 'Identifier'
                  && ['window', 'globalThis', 'self'].includes(callee.object.name) && globalIdentifier(callee.object)
              }
              function glyphs(node, text) {
                if (typeof text === 'string' && GLYPHS.some(glyph => text.includes(glyph))) result.glyphs.push(node.loc.start.line)
              }
              return {
                CallExpression(node) {
                  if (dialogCall(node.callee)) result.nativeDialogs.push(node.loc.start.line)
                },
                JSXText(node) { glyphs(node, node.value) },
                Literal(node) { glyphs(node, node.value) },
                TemplateElement(node) { glyphs(node, node.value.cooked) },
                JSXOpeningElement(node) {
                  const tokens = classes(node)
                  const tag = node.name.name
                  if (tag === 'button' || tag === 'input') {
                    const control = { line: node.loc.start.line, classes: tokens, onClick: context.sourceCode.getText(attribute(node, 'onClick')?.value ?? node) }
                    result.controls.push(control)
                    const toggleInput = tag === 'input' && stringValues(attribute(node, 'type')?.value).some(type => ['checkbox', 'radio'].includes(type))
                    let label = node.parent?.parent
                    while (label && !(label.type === 'JSXElement' && label.openingElement.name.name === 'label')) label = label.parent
                    const largeLabel = toggleInput && label && hasMinimumTouchHeight({ classes: classes(label.openingElement) })
                    for (const token of tokens) {
                      const segments = token.split(':')
                      const utility = segments.pop()
                      const prefix = segments.join(':')
                      const px = utility.startsWith('h-') ? height(utility) : null
                      if (px === null || px >= 44) continue
                      // A min-height on the same control legitimately enlarges its hit area.
                      const minimum = tokens.some(candidate => {
                        const parts = candidate.split(':')
                        const last = parts.pop()
                        return last.startsWith('min-h-') && height(last) >= 44 && (!parts.length || parts.join(':') === prefix)
                      })
                      if (!minimum && !largeLabel) result.undersizedControls.push(node.loc.start.line)
                    }
                  }
                  for (const token of tokens) {
                    if (!/^w-\[(\d+)px\]$/.test(token) || Number(token.match(/\d+/)[0]) <= 450) continue
                    let parent = node.parent
                    let contained = localContainment(node)
                    while (!contained && parent) {
                      if (parent.type === 'JSXElement') contained = localContainment(parent.openingElement)
                      parent = parent.parent
                    }
                    if (!contained) result.fixedWidths.push(node.loc.start.line)
                  }
                },
              }
            },
          },
        },
      },
    },
    rules: { 'quality/responsive': 'error' },
  }])
  const parseErrors = messages.filter(message => message.fatal)
  if (parseErrors.length) throw new Error(parseErrors.map(message => `${message.line}:${message.column} ${message.message}`).join('\n'))
  for (const key of ['nativeDialogs', 'glyphs', 'undersizedControls', 'fixedWidths']) result[key] = [...new Set(result[key])]
  return result
}

export function hasMinimumTouchHeight(control) {
  return control.classes.some(token => !token.includes(':') && height(token) >= 44)
}

// ── Reglas de egress del servidor ────────────────────────────────────────────
// `walk()` de check-project compone las rutas con path.join, que en Windows usa
// `\`: comparar la ruta cruda contra `server/...` hacía que estas dos reglas
// nunca dispararan en desarrollo local (sí en CI/Linux, donde el guardarraíl
// terminaba rompiendo el build). La comparación vive aquí, normalizada, para que
// el escáner y su prueba (scripts/qa-guards.test.mjs) usen la misma.
export function rutaPosix(path) {
  return String(path ?? '').split('\\').join('/')
}

/** Infracciones de egress de una fuente (lista vacía = archivo correcto). */
export function infraccionesEgress(path, source) {
  const ruta = rutaPosix(path)
  const texto = String(source ?? '')
  const fallos = []
  if (ruta === 'server/handlers/nomina.js' && /select=\*/.test(texto)) {
    fallos.push('El handler de nómina no debe usar select=*; proyecta columnas para proteger egress')
  }
  if (ruta.startsWith('server/') && /limit=1000/.test(texto)) {
    fallos.push(`Límite de egress demasiado alto detectado en ${ruta}`)
  }
  return fallos
}
