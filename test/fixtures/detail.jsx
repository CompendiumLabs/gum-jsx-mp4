// Small text, colored strokes, and moving geometry exercise video compression.
return <Video
  size={[320, 180]}
  fps={12}
  duration={1}
  background="#ffffff"
  frame={({ time }) => (
    <Box padding={em(1)} font-size={px(12)}>
      <VStack gap={em(0.5)} align="fill">
        <Text font-weight="bold">Small type · 0123456789 · x + y = z</Text>
        <Graph grow={1} xlim={[0, 2 * pi]} ylim={[-1.2, 1.2]}>
          <Line space="data" from={[0, 0]} to={[2 * pi, 0]} stroke="#8899aa" stroke-width={px(1)} />
          <SymLine
            xlim={[0, 2 * pi]} fy={x => sin(x + 2 * pi * time)}
            stroke="#008080" stroke-width={px(2)} samples={100}
          />
          <SymLine
            xlim={[0, 2 * pi]} fy={x => cos(x - 2 * pi * time)}
            stroke="#b03060" stroke-width={px(1)} samples={100}
          />
        </Graph>
        <Text>Thin strokes and moving curves</Text>
      </VStack>
    </Box>
  )}
/>
