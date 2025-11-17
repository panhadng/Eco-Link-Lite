import { Request, Response, NextFunction } from 'express'

interface Metrics {
  requests: {
    total: number
    byMethod: Record<string, number>
    byStatus: Record<number, number>
  }
  responseTime: {
    count: number
    sum: number
    min: number
    max: number
    avg: number
  }
  uptime: number
  memory: {
    heapUsed: number
    heapTotal: number
    external: number
    rss: number
  }
}

const metrics: Metrics = {
  requests: {
    total: 0,
    byMethod: {},
    byStatus: {},
  },
  responseTime: {
    count: 0,
    sum: 0,
    min: Infinity,
    max: 0,
    avg: 0,
  },
  uptime: process.uptime(),
  memory: process.memoryUsage(),
}

export const metricsMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const startTime = Date.now()

  res.on('finish', () => {
    const duration = Date.now() - startTime

    // Update request counts
    metrics.requests.total++
    metrics.requests.byMethod[req.method] = (metrics.requests.byMethod[req.method] || 0) + 1
    metrics.requests.byStatus[res.statusCode] = (metrics.requests.byStatus[res.statusCode] || 0) + 1

    // Update response time stats
    metrics.responseTime.count++
    metrics.responseTime.sum += duration
    metrics.responseTime.min = Math.min(metrics.responseTime.min, duration)
    metrics.responseTime.max = Math.max(metrics.responseTime.max, duration)
    metrics.responseTime.avg = metrics.responseTime.sum / metrics.responseTime.count

    // Update memory stats
    metrics.memory = process.memoryUsage()
    metrics.uptime = process.uptime()
  })

  next()
}

export const getMetrics = (): Metrics => {
  return {
    ...metrics,
    responseTime: {
      ...metrics.responseTime,
      avg: metrics.responseTime.count > 0 ? metrics.responseTime.sum / metrics.responseTime.count : 0,
    },
    memory: process.memoryUsage(),
    uptime: process.uptime(),
  }
}

export const metricsHandler = (_req: Request, res: Response) => {
  const data = getMetrics()

  // Format as Prometheus-style metrics (text/plain)
  const prometheusFormat = `# HELP http_requests_total Total number of HTTP requests
# TYPE http_requests_total counter
http_requests_total ${data.requests.total}

# HELP http_requests_by_method_total Total number of HTTP requests by method
# TYPE http_requests_by_method_total counter
${Object.entries(data.requests.byMethod)
  .map(([method, count]) => `http_requests_by_method_total{method="${method}"} ${count}`)
  .join('\n')}

# HELP http_requests_by_status_total Total number of HTTP requests by status code
# TYPE http_requests_by_status_total counter
${Object.entries(data.requests.byStatus)
  .map(([status, count]) => `http_requests_by_status_total{status="${status}"} ${count}`)
  .join('\n')}

# HELP http_response_time_ms Response time in milliseconds
# TYPE http_response_time_ms summary
http_response_time_ms_count ${data.responseTime.count}
http_response_time_ms_sum ${data.responseTime.sum}
http_response_time_ms_min ${data.responseTime.min === Infinity ? 0 : data.responseTime.min}
http_response_time_ms_max ${data.responseTime.max}
http_response_time_ms_avg ${data.responseTime.avg.toFixed(2)}

# HELP process_uptime_seconds Process uptime in seconds
# TYPE process_uptime_seconds gauge
process_uptime_seconds ${data.uptime.toFixed(2)}

# HELP process_memory_heap_used_bytes Heap memory used in bytes
# TYPE process_memory_heap_used_bytes gauge
process_memory_heap_used_bytes ${data.memory.heapUsed}

# HELP process_memory_heap_total_bytes Total heap memory in bytes
# TYPE process_memory_heap_total_bytes gauge
process_memory_heap_total_bytes ${data.memory.heapTotal}

# HELP process_memory_external_bytes External memory in bytes
# TYPE process_memory_external_bytes gauge
process_memory_external_bytes ${data.memory.external}

# HELP process_memory_rss_bytes Resident set size in bytes
# TYPE process_memory_rss_bytes gauge
process_memory_rss_bytes ${data.memory.rss}
`

  res.setHeader('Content-Type', 'text/plain; version=0.0.4')
  res.send(prometheusFormat)
}

export const metricsJsonHandler = (_req: Request, res: Response) => {
  res.json(getMetrics())
}
