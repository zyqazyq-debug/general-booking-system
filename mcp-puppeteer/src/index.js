import 'dotenv/config'
import fs from 'fs'
import puppeteer from 'puppeteer-core'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'

function pickExec() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH && fs.existsSync(process.env.PUPPETEER_EXECUTABLE_PATH)) {
    return process.env.PUPPETEER_EXECUTABLE_PATH
  }
  const candidates = [
    'C:\\\\Program Files\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe',
    'C:\\\\Program Files (x86)\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe',
    'C:\\\\Program Files\\\\Microsoft\\\\Edge\\\\Application\\\\msedge.exe',
    'C:\\\\Program Files (x86)\\\\Microsoft\\\\Edge\\\\Application\\\\msedge.exe',
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  return undefined
}

const server = new Server(
  {
    name: 'mcp-puppeteer',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
    },
  },
)

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'ping',
        description: 'Health check for MCP Puppeteer server',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'navigate_title',
        description: 'Open a URL in headless browser and return page title',
        inputSchema: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'Target URL to navigate to',
            },
          },
          required: ['url'],
        },
      },
    ],
  }
})

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const tool = request.params.name
  if (tool === 'ping') {
    return {
      content: [{ type: 'text', text: 'pong' }],
    }
  }
  if (tool === 'navigate_title') {
    const url = request.params.arguments?.url
    if (!url || typeof url !== 'string') {
      throw new Error('url is required and must be a string')
    }
    const execPath = pickExec()
    const launchOptions = { headless: 'new' }
    if (execPath) {
      launchOptions.executablePath = execPath
    }
    const browser = await puppeteer.launch(launchOptions)
    try {
      const page = await browser.newPage()
      await page.goto(url, { waitUntil: 'networkidle2' })
      const title = await page.title()
      return {
        content: [{ type: 'text', text: title }],
      }
    } finally {
      await browser.close()
    }
  }
  throw new Error(`Unknown tool: ${tool}`)
})

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('mcp-puppeteer stdio server started')
}

main().catch((e) => {
  console.error('MCP server error:', e?.message || e)
  process.exit(1)
})
