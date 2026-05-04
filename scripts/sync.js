import { promises as fs } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import chokidar from 'chokidar'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST_DIR = path.join(__dirname, '..', 'dist')
const WE_PROJECT_DIR = path.join(
  'C:',
  'Program Files (x86)',
  'Steam',
  'steamapps',
  'common',
  'wallpaper_engine',
  'projects',
  'myprojects',
  'heroes_iii_dynam'
)

async function copyFile(src, dest) {
  await fs.mkdir(path.dirname(dest), { recursive: true })
  await fs.copyFile(src, dest)
  console.log(`Synced: ${path.relative(DIST_DIR, src)} -> ${path.relative(WE_PROJECT_DIR, dest)}`)
}

async function copyDir(src, dest) {
  await fs.mkdir(dest, { recursive: true })
  const entries = await fs.readdir(src, { withFileTypes: true })

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)

    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath)
    } else {
      await copyFile(srcPath, destPath)
    }
  }
}

async function sync() {
  console.log('Syncing to Wallpaper Engine project folder...\n')

  const filesToSync = ['index.html', 'project.json', 'favicon.svg', 'icons.svg']

  for (const file of filesToSync) {
    const src = path.join(DIST_DIR, file)
    const dest = path.join(WE_PROJECT_DIR, file)
    try {
      await copyFile(src, dest)
    } catch (err) {
      console.error(`Failed to sync ${file}:`, err.message)
    }
  }

  const assetsSrc = path.join(DIST_DIR, 'assets')
  const assetsDest = path.join(WE_PROJECT_DIR, 'assets')
  try {
    await copyDir(assetsSrc, assetsDest)
  } catch (err) {
    console.error('Failed to sync assets:', err.message)
  }

  console.log('\nSync complete!')
}

async function watch() {
  console.log('Watching for changes...\n')

  const watcher = chokidar.watch(DIST_DIR, {
    persistent: true,
    ignoreInitial: true,
  })

  watcher.on('all', async (event, filePath) => {
    const relativePath = path.relative(DIST_DIR, filePath)
    const destPath = path.join(WE_PROJECT_DIR, relativePath)

    try {
      if (event === 'add' || event === 'change') {
        await copyFile(filePath, destPath)
      } else if (event === 'unlink') {
        await fs.unlink(destPath)
        console.log(`Removed: ${relativePath}`)
      }
    } catch (err) {
      console.error(`Sync error for ${relativePath}:`, err.message)
    }
  })

  process.on('SIGINT', () => {
    console.log('\nStopping watcher...')
    watcher.close()
    process.exit(0)
  })
}

const args = process.argv.slice(2)
if (args.includes('--watch')) {
  watch()
} else {
  sync()
}
