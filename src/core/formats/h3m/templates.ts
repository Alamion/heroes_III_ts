import type { H3mContext } from './context.ts'
import type { ObjectTemplate } from './types.ts'

export function readTemplates(c: H3mContext): ObjectTemplate[] {
  return c.r.scope('templates', () => {
    const at = c.r.offset
    const count = c.r.u32()
    if (count > 10_000) c.r.invalid(`template count ${count} exceeds 10000`, at)
    return Array.from({ length: count }, (_, i) =>
      c.r.scope(`[${i}]`, () => {
        const defName = c.r.string(255).text
        const passable = c.r.bytesCopy(6)
        const active = c.r.bytesCopy(6)
        const allowedTerrains = c.r.u16()
        const editorGroups = c.r.u16()
        const classId = c.r.u32()
        const subclassId = c.r.u32()
        const group = c.r.u8()
        const isOverlay = c.r.flag()
        c.r.zeros(16, 'template padding')
        return { defName, passable, active, allowedTerrains, editorGroups, classId, subclassId, group, isOverlay }
      }),
    )
  })
}
