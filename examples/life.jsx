// One generation per frame. Change the seed or density for a different world.
const columns = 72
const rows = 30
const fps = 12
const duration = 16
const seed = 42
const density = 0.25

const background = '#0b1320'
const newborn = '#c6f68d'
const survivor = '#4bd6b1'

// Conway's B3/S23 rule: all cells update together, with wraparound edges.
function next_generation(cells) {
  return cells.map((alive, index) => {
    const x = index % columns
    const y = Math.floor(index / columns)
    let neighbors = 0
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue
        const nx = (x + dx + columns) % columns
        const ny = (y + dy + rows) % rows
        neighbors += cells[ny * columns + nx]
      }
    }
    return Number(neighbors === 3 || (alive && neighbors === 2))
  })
}

// Precompute states once so the frame generator can seek in any order.
setSeed(seed)
const states = [Array.from({ length: columns * rows }, () => Number(random() < density))]
for (let generation = 1; generation < Math.ceil(duration * fps); generation++) {
  states.push(next_generation(states[generation - 1]))
}
const populations = states.map(cells => cells.reduce((sum, alive) => sum + alive, 0))

// Share the stationary grid between frames; only live cells change.
const grid = (
  <>
    <Rect width="fill" height="fill" fill="#111e2d" stroke="none" />
    {Array.from({ length: columns + 1 }, (_, x) => (
      <Line from={[x / columns, 0]} to={[x / columns, 1]} />
    ))}
    {Array.from({ length: rows + 1 }, (_, y) => (
      <Line from={[0, y / rows]} to={[1, y / rows]} />
    ))}
  </>
)

// Render a snapshot without advancing the simulation or drawing random numbers.
function render_frame({ frame }) {
  const cells = states[frame]
  const previous = states[frame - 1]
  return (
    <Box padding={em(1.5)} font-size={px(18)} color="#e8f0f7">
      <VStack gap={em(1)} align="fill">
        <HStack align="center" gap={em(1)}>
          <Text grow={1} font-size={em(1.6)} font-weight="bold">Conway's Game of Life</Text>
          <Text color="#9aaec2" font-size={em(0.85)}>
            Generation {String(frame).padStart(3, '0')} · {populations[frame]} alive
          </Text>
        </HStack>
        <Group width="fill" aspect={columns / rows} stroke="#213247" stroke-width={px(0.5)}>
          {grid}
          {cells.map((alive, index) => alive ? (
            <Rect
              pos={[index % columns / columns, Math.floor(index / columns) / rows]}
              anchor="start" width={1 / columns} height={1 / rows}
              fill={previous?.[index] ? survivor : newborn}
              stroke={background} stroke-width={px(1)}
            />
          ) : null)}
        </Group>
        <HStack gap={em(1)} font-size={em(0.8)} align="center">
          <Text grow={1} color="#9aaec2">Birth: 3 neighbors · Survive: 2 or 3 · Wraparound edges</Text>
          <Text color={newborn}>Newborn</Text>
          <Text color={survivor}>Surviving</Text>
        </HStack>
      </VStack>
    </Box>
  )
}

return (
  <Video
    size={[960, 540]}
    fps={fps}
    duration={duration}
    background={background}
    frame={render_frame}
  />
)
