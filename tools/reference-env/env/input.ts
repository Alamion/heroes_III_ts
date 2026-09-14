// xdotool bound to one virtual display. Never uses the developer's DISPLAY.
import type { Point } from '../model/types.ts'
import { runProcess, sleep } from './process.ts'

export interface Input {
  move(p: Point): Promise<void>
  click(p: Point, button?: 1 | 2 | 3): Promise<void>
  key(name: string): Promise<void>
  keyDown(name: string): Promise<void>
  keyUp(name: string): Promise<void>
  /** Sends characters as separate key presses with a pause (the game drops fast input). */
  typeSlowly(text: string, delayMs: number): Promise<void>
}

export function createInput(display: string): Input {
  const env = { ...process.env, DISPLAY: display }
  const x = async (...args: string[]): Promise<void> => {
    await runProcess('xdotool', args, { env, timeoutMs: 10_000 })
  }
  return {
    move: (p) => x('mousemove', String(p.x), String(p.y)),
    click: async (p, button = 1) => {
      await x('mousemove', String(p.x), String(p.y))
      await sleep(80)
      await x('click', String(button))
    },
    key: (name) => x('key', name),
    keyDown: (name) => x('keydown', name),
    keyUp: (name) => x('keyup', name),
    typeSlowly: async (text, delayMs) => {
      for (const ch of text) {
        await x('key', ch)
        await sleep(delayMs)
      }
    },
  }
}
