import type { H3mContext } from '../context.ts'
import type { ObjectBody, Quest, SeerReward } from '../types.ts'
import { readArtifactId, readCreatureId, readQuest } from './common.ts'

function readSeerReward(c: H3mContext): SeerReward {
  const r = c.r
  return r.scope('reward', () => {
    const at = r.offset
    const type = r.u8()
    switch (type) {
      case 0:
        return { kind: 'none' }
      case 1:
        return { kind: 'experience', value: r.u32() }
      case 2:
        return { kind: 'spellPoints', value: r.u32() }
      case 3:
        return { kind: 'morale', value: r.i8() }
      case 4:
        return { kind: 'luck', value: r.i8() }
      case 5:
        return { kind: 'resource', resource: r.u8(), amount: r.u32() }
      case 6:
        return { kind: 'primarySkill', skill: r.u8(), value: r.u8() }
      case 7:
        return { kind: 'secondarySkill', skill: r.u8(), level: r.u8() }
      case 8:
        return { kind: 'artifact', artifact: readArtifactId(c) }
      case 9:
        return { kind: 'spell', spell: r.u8() }
      case 10:
        return { kind: 'creature', creature: readCreatureId(c), count: r.u16() }
      default:
        return r.invalid(`unknown seer hut reward type ${type}`, at)
    }
  })
}

export function readSeerHut(c: H3mContext): ObjectBody {
  const r = c.r
  let quest: Quest
  if (c.ab) {
    quest = readQuest(c)
  } else {
    // RoE: the only quest is "bring one artifact"; 0xFF = no quest.
    const artifact = r.scope('quest', () => r.u8())
    quest = artifact === 0xff ? { kind: 'none' } : { kind: 'artifacts', artifacts: [artifact], deadline: -1, proposal: emptyString(), progress: emptyString(), completion: emptyString() }
  }
  if (quest.kind === 'none') {
    r.zeros(3, 'seer hut without quest')
    return { kind: 'seerHut', quest, reward: { kind: 'none' } }
  }
  const reward = readSeerReward(c)
  r.zeros(2, 'seer hut padding')
  return { kind: 'seerHut', quest, reward }
}

export function readQuestGuard(c: H3mContext): ObjectBody {
  return { kind: 'questGuard', quest: readQuest(c) }
}

function emptyString(): { bytes: Uint8Array; text: string } {
  return { bytes: new Uint8Array(0), text: '' }
}
