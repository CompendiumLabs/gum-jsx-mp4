// Gum evaluates this file once. Each frame is an ordinary figure at a given time.
const start_x = -12
const end_x = 10
const speed = 11 / 6
const duration = (end_x - start_x) / speed
const radius = 1.8
const pitch = 3.5
const trail_duration = 3 * pitch / speed
const samples = 192

// Look across the helix and slightly down onto it, with z pointing up.
const eye = {x: 11, y: -24, z: 10}
const distance = Math.hypot(eye.x, eye.y, eye.z)
const projection = perspective_projection({eye, focal_length: distance})
const depth = point => distance - (
  point.x * eye.x + point.y * eye.y + point.z * eye.z
) / distance

const spiral = time => {
  const x = start_x + speed * time
  const angle = tau * (x + 1) / pitch
  return {x, y: radius * cos(angle), z: radius * sin(angle)}
}

// Static geometry is shared by every frame. The grid makes forward travel visible.
const floor = -2.5
const grid = [
  ...linspace(-12, 12, 13).map(x => [
    {x, y: -3, z: floor},
    {x, y: 3, z: floor},
  ]),
  ...linspace(-3, 3, 5).map(y => [
    {x: -12, y, z: floor},
    {x: 12, y, z: floor},
  ]),
]
const guide = linspace(0, duration, 401).map(spiral)
const ages = linspace(trail_duration, 0, samples + 1)

const frame = ({ time }) => {
  // Grow the trail from the entry point until it reaches its full three turns.
  const oldest = Math.min(time, trail_duration)
  const frame_ages = [oldest, ...ages.filter(age => age < oldest)]
  const points = frame_ages.map(age => spiral(time - age))
  const head = spiral(time)
  const head_scale = distance / depth(head)
  const segments = points.slice(1).map((point, index) => {
    const strength = 1 - frame_ages[index + 1] / trail_duration
    const segment_depth = (depth(points[index]) + depth(point)) / 2
    const brightness = 0.08 + 0.92 * strength ** 1.4
    // Blend into the background with opaque strokes to avoid bright seams at joins.
    const color = [142, 105, 245].map((channel, axis) => (
      lerp([16, 24, 39][axis], lerp(channel, [66, 232, 245][axis], strength), brightness)
    ))
    return {
      points: [points[index], point],
      depth: segment_depth,
      scale: distance / segment_depth,
      brightness,
      color: `rgb(${color.join(', ')})`,
    }
  })

  // Gum projects positions; we sort the short strokes from far to near ourselves.
  segments.sort((a, b) => b.depth - a.depth)

  return (
    <Box padding={em(1.5)} color="#e5edf7" font-size={px(20)}>
      <VStack gap={em(0.8)} align="fill">
        <Text font-size={em(1.6)} font-weight="bold">A spiral through space.</Text>
        <Group grow={1}>
          <Graph
            pos={[0.5, 0.5]} width="fill" aspect={2.5}
            xlim={[-14, 14]} ylim={[-7.2, 4]}
            projection={projection}
          >
            {grid.map(points => (
              <Polyline points={points} stroke="#26364a" stroke-width={px(1)} />
            ))}
            <Arrow
              from={{x: -12, y: 0, z: 0}} to={{x: 12, y: 0, z: 0}}
              stroke="#42556e" stroke-width={px(1)}
              stroke-dasharray={px(5)} head-size={px(7)}
            />
            <Polyline points={guide} stroke="#2e4058" stroke-width={px(1)} />
            <Polyline
              points={points.map(({x, y}) => ({x, y, z: floor}))}
              stroke="#47b6bd" stroke-width={px(2)} opacity={0.12}
            />
            {segments.map(segment => (
              <Polyline
                points={segment.points} stroke={segment.color}
                stroke-width={px(10 * segment.scale)}
                stroke-linecap="round" opacity={0.06 * segment.brightness}
              />
            ))}
            {segments.map(segment => (
              <Polyline
                points={segment.points} stroke={segment.color}
                stroke-width={px(3.5 * segment.scale)}
                stroke-linecap="round"
              />
            ))}
            <Points
              points={[head]} point-size={px(25 * head_scale)}
              fill="#42e8f5" opacity={0.12}
            />
            <Points
              points={[head]} point-size={px(12 * head_scale)}
              fill="#42e8f5"
            />
            <Points
              points={[head]} point-size={px(5 * head_scale)}
              fill="#efffff"
            />
          </Graph>
        </Group>
        <HStack align="center">
          <Text grow={1} font-size={em(0.8)} color="#94a6be">
            A moving point, a fading trail, and a perspective camera.
          </Text>
          <Text font-size={em(0.8)} color="#42e8f5">{time.toFixed(2)} s</Text>
        </HStack>
      </VStack>
    </Box>
  )
}

return (
  <Video
    size={[960, 540]}
    fps={30}
    duration={duration}
    background="#101827"
    frame={frame}
  />
)
