/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable import/no-named-as-default-member */
import http from 'node:http'

import { ApolloServer } from 'apollo-server-express'
import bodyParser from 'body-parser'
import express from 'express'
import { graphqlUploadExpress } from 'graphql-upload'
import helmet from 'helmet'

import CONFIG from './config'
import { context, getContext } from './context'
import schema from './graphql/schema'
import middleware from './middleware'
import { metricsMiddleware, metricsHandler, metricsJsonHandler } from './middleware/metrics'

import type { ApolloServerExpressConfig } from 'apollo-server-express'

const createServer = (options?: ApolloServerExpressConfig) => {
  const defaults: ApolloServerExpressConfig = {
    context,
    schema: middleware(schema),
    subscriptions: {
      onConnect: (connectionParams) =>
        getContext()(connectionParams as { headers: { authorization?: string } }),
    },
    debug: !!CONFIG.DEBUG,
    uploads: false,
    tracing: !!CONFIG.DEBUG,
    formatError: (error) => {
      // console.log(error.originalError)
      if (error.message === 'ERROR_VALIDATION') {
        return new Error((error.originalError as any).details.map((d) => d.message))
      }
      return error
    },
  }
  const server = new ApolloServer(Object.assign(defaults, options))

  const app = express()

  // TODO: this exception is required for the graphql playground, since the playground loads external resources
  // See: https://github.com/graphql/graphql-playground/issues/1283
  app.use(
    helmet(
      (CONFIG.DEBUG && { contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }) || {},
    ) as any,
  )
  app.use(express.static('public'))
  app.use(bodyParser.json({ limit: '20mb' }) as any)
  app.use(bodyParser.urlencoded({ limit: '20mb', extended: true }) as any)
  
  // Metrics middleware - track all requests
  app.use(metricsMiddleware)
  
  // Metrics endpoints - must be defined BEFORE Apollo Server middleware
  app.get('/metrics', metricsHandler)
  app.get('/metrics/json', metricsJsonHandler)
  
  app.use(graphqlUploadExpress({ maxFileSize: 20 * 1024 * 1024 })) // 20MB max file size
  server.applyMiddleware({ 
    app, 
    path: '/',
    cors: {
      origin: [CONFIG.CLIENT_URI, 'http://localhost:3000', 'http://localhost:3001', 'http://13.203.0.20', 'http://13.203.0.20:3000', 'http://13.203.0.20:3001' ,'https://eco-link.flyonit.com.au'],
      credentials: true,
    },
  })
  const httpServer = http.createServer(app)
  server.installSubscriptionHandlers(httpServer)

  return { server, httpServer, app }
}

export default createServer
