// Gum evaluates this file once. Each frame is an ordinary figure at a given time.
const duration = 6
const accent = '#36cfc9'
const center = [0.5, 0.5]
const radius = [0.22, 0.38]

const frame = ({ time }) => {
  const angle = 2 * pi * time / duration
  const position = [
    center[0] + radius[0] * cos(angle),
    center[1] - radius[1] * sin(angle),
  ]
  return (
    <Box padding={em(1.5)} color="#e5edf7" font-size={px(24)}>
      <VStack gap={em(2 / 3)} align="fill">
        <Text font-size={em(4 / 3)} font-weight="bold">A figure, with time.</Text>
        <Group grow={1}>
          <Ellipse
            width="fill" height="fill"
            center={center} radius={radius}
            fill="none" stroke="#34445c" stroke-width={em(1 / 12)}
          />
          <Line from={center} to={position} stroke={accent} stroke-width={em(1 / 8)} />
          <Circle pos={center} width={em(0.5)} fill="#e5edf7" stroke="none" />
          <Circle pos={position} width={em(1)} fill={accent} stroke="none" />
        </Group>
        <Text font-size={em(0.75)} color="#94a6be">Gum JSX → frames → video</Text>
      </VStack>
    </Box>
  )
}

return {
  size: [960, 540],
  fps: 30,
  duration,
  background: '#101827',
  frame,
}
