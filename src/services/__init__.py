"""Shared business helpers used by two or more routers.

Anything called from a single router stays private to that router module; code
shared across routers lives here so routers depend on services, never on each
other or on ``app``.
"""
