# CoinPulse acceptance objectives
The source of truth for browser acceptance criteria is `configs/coinpulse.json`. Tests use deterministic seeded fixtures and no external crypto API. The `?fixture=malformed` URL sets Chainlink market price to null for resilience testing.
