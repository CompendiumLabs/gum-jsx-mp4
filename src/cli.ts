#!/usr/bin/env bun
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Command } from 'commander'
import { format_image } from '@gum-jsx/cli/kitty'
import { create_renderer, evaluate_mp4, render_mp4 } from './index'

const program = new Command().name('gum-mp4').description('Render animated Gum JSX with Bun and WebAssembly.').version('0.1.0')
const load = async (file: string) => evaluate_mp4(await readFile(file, 'utf8'), resolve(file))

program.command('render').argument('<source.jsx>')
  .requiredOption('-o, --output <file.mp4>', 'MP4 output (replaces an existing file after success)')
  .option('--qp <number>', 'H.264 quantizer, 10–51; lower is higher quality', '18')
  .action(async (file: string, options: { output: string; qp: string }) => {
    const controller = new AbortController()
    const cancel = () => controller.abort(new Error('Render cancelled'))
    process.once('SIGINT', cancel)
    process.once('SIGTERM', cancel)
    try {
      await render_mp4(await load(file), options.output, {
        qp: Number(options.qp), signal: controller.signal,
        on_progress(completed, total) {
          if (completed === total || completed % 30 === 0) process.stderr.write(`\rFrames: ${completed}/${total}`)
        },
      })
      process.stderr.write(`\nSaved ${options.output}\n`)
    } finally {
      process.removeListener('SIGINT', cancel)
      process.removeListener('SIGTERM', cancel)
    }
  })

program.command('frame').argument('<source.jsx>')
  .option('-o, --output <file.png>', 'Save PNG instead of displaying Kitty graphics on stdout')
  .option('--time <seconds>', 'Sample the frame containing this time', '0')
  .action(async (file: string, options: { output?: string; time: string }) => {
    if (options.output !== undefined && !options.output.toLowerCase().endsWith('.png')) throw new Error('Frame output must end in .png')
    const renderer = create_renderer(await load(file))
    const time = Number(options.time)
    if (!Number.isFinite(time) || time < 0 || time >= renderer.video.duration) {
      throw new RangeError('time must be finite, nonnegative, and less than duration')
    }
    const png = renderer.png(Math.floor(time * renderer.video.fps))
    if (options.output !== undefined) {
      await writeFile(options.output, png)
      process.stderr.write(`Saved ${options.output}\n`)
    } else {
      process.stdout.write(format_image(Buffer.from(png)) + '\n')
    }
  })

try {
  await program.parseAsync()
} catch (error) {
  console.error(`gum-video: ${error instanceof Error ? error.message : error}`)
  process.exitCode = 1
}
