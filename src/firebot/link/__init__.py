"""Robot <-> PC link. The Pi only streams sensor frames and applies commands; all processing,
planning, speech and logging happen on the PC ("brain").

`protocol` and `agent` are stdlib-only so they run on a bare Raspberry Pi.
"""
