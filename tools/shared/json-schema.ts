// Minimal JSON Schema validator for the report schemas in specs/ (subset: $ref, type, required,
// enum, properties, items, additionalProperties). Tools only; no dependency.

export interface SchemaError {
  path: string
  message: string
}

type Schema = Record<string, unknown>

function typeOf(v: unknown): string {
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'array'
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number'
  return typeof v
}

function typeMatches(expected: string, v: unknown): boolean {
  const t = typeOf(v)
  return expected === t || (expected === 'number' && t === 'integer')
}

export function validateJson(root: Schema, schema: Schema, value: unknown, path = '$', errors: SchemaError[] = []): SchemaError[] {
  if (typeof schema.$ref === 'string') {
    const ref = schema.$ref
    if (!ref.startsWith('#/')) throw new Error(`unsupported $ref ${ref}`)
    let target: unknown = root
    for (const part of ref.slice(2).split('/')) target = (target as Record<string, unknown>)[part]
    return validateJson(root, target as Schema, value, path, errors)
  }
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? (schema.type as string[]) : [schema.type as string]
    if (!types.some((t) => typeMatches(t, value))) {
      errors.push({ path, message: `expected ${types.join('|')}, got ${typeOf(value)}` })
      return errors
    }
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) errors.push({ path, message: `expected one of ${JSON.stringify(schema.enum)}` })
  if (typeOf(value) === 'object') {
    const obj = value as Record<string, unknown>
    for (const key of (schema.required as string[] | undefined) ?? []) if (!(key in obj)) errors.push({ path: `${path}.${key}`, message: 'required' })
    const props = (schema.properties as Record<string, Schema> | undefined) ?? {}
    for (const [key, v] of Object.entries(obj)) {
      const sub = props[key]
      if (sub !== undefined) validateJson(root, sub, v, `${path}.${key}`, errors)
      else if (schema.additionalProperties !== undefined && typeof schema.additionalProperties === 'object') validateJson(root, schema.additionalProperties as Schema, v, `${path}.${key}`, errors)
    }
  }
  if (Array.isArray(value) && schema.items !== undefined) value.forEach((item, i) => validateJson(root, schema.items as Schema, item, `${path}[${i}]`, errors))
  return errors
}
