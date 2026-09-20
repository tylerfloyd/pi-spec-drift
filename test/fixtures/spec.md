# Weather CLI

## Purpose
`weather` is a terminal app that prints the current conditions for a city.

## Behavior
- `weather <city>` prints temperature, humidity, and wind.
- Output is plain text to stdout.
- Unknown cities exit with code 2 and a message on stderr.

## Non-goals
- No historical data.
- No network calls except to the configured weather provider.
