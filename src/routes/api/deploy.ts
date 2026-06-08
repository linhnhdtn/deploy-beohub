import { spawn } from 'node:child_process'
import { timingSafeEqual } from 'node:crypto'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/deploy')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authResult = authorizeDeploy(request)
        if (authResult) return authResult

        if (activeDeploy) {
          return Response.json(
            { error: 'A deploy is already running.' },
            { status: 409 },
          )
        }

        let body: unknown
        try {
          body = await request.json()
        } catch {
          return Response.json({ error: 'Invalid JSON body.' }, { status: 400 })
        }

        const branch = getBranch(body)
        if (!branch) {
          return Response.json(
            {
              error:
                'Branch is required and may only contain letters, numbers, ".", "_", "-", and "/".',
            },
            { status: 400 },
          )
        }

        activeDeploy = true

        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            const encoder = new TextEncoder()
            const write = (event: DeployEvent) => {
              controller.enqueue(
                encoder.encode(`${JSON.stringify({ time: now(), ...event })}\n`),
              )
            }

            try {
              write({
                stage: 'Deploy',
                level: 'info',
                message: `Deploy directory: ${deployDirectory}`,
              })
              write({
                stage: 'Deploy',
                level: 'info',
                message: `Branch: ${branch}`,
              })

              await runCommand('Git', 'git', ['fetch', 'origin'], write)
              await runCommand('Git', 'git', ['checkout', branch], write)
              await runCommand(
                'Git',
                'git',
                ['pull', '--ff-only', 'origin', branch],
                write,
              )
              await runCommand(
                'Capistrano',
                'bundle',
                ['exec', 'cap', 'dev', 'deploy'],
                write,
              )

              write({
                stage: 'Deploy',
                level: 'info',
                message: 'Deploy completed successfully.',
                status: 'success',
              })
            } catch (error) {
              write({
                stage: 'Deploy',
                level: 'error',
                message:
                  error instanceof Error ? error.message : 'Deploy failed.',
                status: 'failed',
              })
            } finally {
              activeDeploy = false
              controller.close()
            }
          },
        })

        return new Response(stream, {
          headers: {
            'Cache-Control': 'no-cache, no-transform',
            'Content-Type': 'application/x-ndjson; charset=utf-8',
            'X-Accel-Buffering': 'no',
          },
        })
      },
    },
  },
})

type DeployEvent = {
  stage: string
  level: 'info' | 'warn' | 'error'
  message: string
  status?: 'success' | 'failed'
}

const deployDirectory = '/home/ziczac/Sites/cap-deploy/beohub'
const branchPattern = /^(?!-)[A-Za-z0-9._/-]+$/

let activeDeploy = false

function authorizeDeploy(request: Request) {
  const expectedToken = process.env.DEPLOY_TOKEN
  if (!expectedToken) {
    return Response.json(
      { error: 'DEPLOY_TOKEN is not configured on the server.' },
      { status: 500 },
    )
  }

  const authorization = request.headers.get('Authorization') ?? ''
  const token = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : ''

  if (!token || !tokensMatch(token, expectedToken)) {
    return Response.json({ error: 'Invalid deploy token.' }, { status: 401 })
  }

  return null
}

function tokensMatch(actual: string, expected: string) {
  const actualBuffer = Buffer.from(actual)
  const expectedBuffer = Buffer.from(expected)

  if (actualBuffer.length !== expectedBuffer.length) return false

  return timingSafeEqual(actualBuffer, expectedBuffer)
}

function getBranch(body: unknown) {
  if (!body || typeof body !== 'object' || !('branch' in body)) return null

  const branch = (body as { branch: unknown }).branch
  if (typeof branch !== 'string') return null

  const trimmed = branch.trim()
  if (!trimmed || !branchPattern.test(trimmed)) return null

  return trimmed
}

function runCommand(
  stage: string,
  command: string,
  args: Array<string>,
  write: (event: DeployEvent) => void,
) {
  return new Promise<void>((resolve, reject) => {
    write({
      stage,
      level: 'info',
      message: `$ ${[command, ...args].join(' ')}`,
    })

    const child = spawn(command, args, {
      cwd: deployDirectory,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')

    child.stdout.on('data', (chunk: string) => {
      writeLines(stage, 'info', chunk, write)
    })

    child.stderr.on('data', (chunk: string) => {
      writeLines(stage, 'warn', chunk, write)
    })

    child.on('error', (error) => {
      reject(error)
    })

    child.on('close', (code) => {
      if (code === 0) {
        resolve()
        return
      }

      reject(new Error(`${command} exited with code ${code ?? 'unknown'}.`))
    })
  })
}

function writeLines(
  stage: string,
  level: DeployEvent['level'],
  chunk: string,
  write: (event: DeployEvent) => void,
) {
  const lines = chunk.split(/\r?\n/)

  for (const line of lines) {
    if (!line) continue

    write({
      stage,
      level,
      message: line,
    })
  }
}

function now() {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date())
}
