import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";

const app = express();

// Trust proxy headers for correct client IP identification in Replit environment
// Configure for Replit's specific proxy setup
app.set('trust proxy', 1);

// Enhanced body parsing with security limits
app.use(express.json({ 
  limit: '10mb',
  strict: true,
  verify: (req, res, buf) => {
    // Prevent prototype pollution
    const body = buf.toString();
    if (body.includes('__proto__') || body.includes('constructor') || body.includes('prototype')) {
      throw new Error('Potential prototype pollution attempt detected');
    }
  }
}));
app.use(express.urlencoded({ 
  extended: false, 
  limit: '10mb',
  parameterLimit: 100
}));

// Enhanced security and logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  // Security headers for all responses
  res.set({
    'X-Powered-By': '', // Remove Express fingerprinting
    'Server': '', // Remove server fingerprinting  
    'X-Request-ID': Date.now().toString(36)
  });

  // Enhanced logging for security monitoring
  if (path.startsWith("/api")) {
    const clientInfo = {
      ip: req.ip,
      userAgent: req.get('User-Agent')?.substring(0, 200),
      referer: req.get('Referer'),
      method: req.method,
      path: path
    };
    console.log(`[SECURITY] API Request: ${JSON.stringify(clientInfo)}`);
  }

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      
      // Enhanced logging for errors and slow requests
      if (res.statusCode >= 400 || duration > 5000) {
        console.log(`[SECURITY] Slow/Error Response: ${logLine} from IP: ${req.ip}`);
      }
      
      if (capturedJsonResponse && !capturedJsonResponse.error) {
        // Only log success responses in development
        if (process.env.NODE_ENV === 'development') {
          logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
        }
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || '5000', 10);
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true,
  }, () => {
    log(`serving on port ${port}`);
  });
})();
