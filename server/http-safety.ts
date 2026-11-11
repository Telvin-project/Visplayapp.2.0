import type { Express, NextFunction, Request, Response } from 'express';

/**
 * Express 4 does not automatically forward rejected async route promises to
 * error middleware. Wrap route registrations once, before defining endpoints.
 * Without this guard an optimistic-concurrency conflict could reject outside
 * Express and leave the client without a safe response.
 */
export function protectAsyncRoutes(app: Express): void {
  const target = app as unknown as Record<string, (...args: any[]) => unknown>;
  for (const method of ['get', 'post', 'put', 'patch', 'delete', 'all'] as const) {
    const original = target[method].bind(app);
    target[method] = (pathOrSetting: unknown, ...handlers: unknown[]) => {
      // Express overload: app.get('setting') returns the configuration value.
      if (method === 'get' && !handlers.length) return original(pathOrSetting);
      const wrapped = handlers.map(handler => {
        if (typeof handler !== 'function' || handler.length >= 4) return handler;
        return (req: Request, res: Response, next: NextFunction) => {
          try {
            const result = handler(req, res, next);
            if (result && typeof result.then === 'function') result.catch(next);
          } catch (error) { next(error); }
        };
      });
      return original(pathOrSetting, ...wrapped);
    };
  }
}
