import { expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('frame defaults to Kitty graphics and -o saves the same PNG', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gum-video-cli-'))
  try {
    const source = join(directory, 'scene.jsx')
    const output = join(directory, 'frame.png')
    await writeFile(source, `return {
      size: [64, 48], fps: 2, duration: 1,
      frame: ({ time }) => <Svg background={time === 0 ? 'red' : 'blue'} />,
    }`)
    const cli = join(import.meta.dir, '../src/cli.ts')
    const preview = Bun.spawnSync([process.execPath, cli, 'frame', source, '--time', '0.5'])
    expect(preview.exitCode).toBe(0)
    expect(preview.stderr.toString()).toBe('')
    const text = preview.stdout.toString()
    expect(text.startsWith('\x1b_Gf=100,a=T,q=1,')).toBe(true)
    const packets = [...text.matchAll(/\x1b_G([^;]*);([^\x1b]*)\x1b\\/g)]
    expect(packets.length).toBeGreaterThan(0)
    expect(packets.at(-1)![1]).toContain('m=0')
    const png = Buffer.from(packets.map(packet => packet[2]).join(''), 'base64')
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])

    const saved = Bun.spawnSync([process.execPath, cli, 'frame', source, '--time', '0.5', '-o', output])
    expect(saved.exitCode).toBe(0)
    expect(saved.stdout.length).toBe(0)
    expect(await readFile(output)).toEqual(png)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
