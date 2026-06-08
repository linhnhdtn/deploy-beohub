import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useMemo, useRef, useState } from 'react'

export const Route = createFileRoute('/')({ component: DeployHome })

type DeployStatus = 'idle' | 'running' | 'success' | 'failed'

type DeployStep = {
  name: string
}

type DeployLog = {
  time: string
  stage: string
  level: 'info' | 'warn' | 'error'
  message: string
  status?: 'success' | 'failed'
}

const steps: DeployStep[] = [
  { name: 'Fetch' },
  { name: 'Checkout' },
  { name: 'Pull' },
  { name: 'Capistrano' },
]

const deployDirectory = '/home/ziczac/Sites/cap-deploy/beohub'
const branchPattern = /^(?!-)[A-Za-z0-9._/-]+$/

function DeployHome() {
  const [branch, setBranch] = useState('main')
  const [status, setStatus] = useState<DeployStatus>('idle')
  const [logs, setLogs] = useState<Array<DeployLog>>([])
  const [runCount, setRunCount] = useState(1044)
  const consoleRef = useRef<HTMLDivElement>(null)

  const deployLabel = useMemo(() => {
    if (status === 'running') return 'RUNNING'
    if (status === 'success') return 'SUCCESS'
    if (status === 'failed') return 'FAILED'
    return 'READY'
  }, [status])

  const branchIsValid = useMemo(() => {
    return Boolean(branch.trim() && branchPattern.test(branch.trim()))
  }, [branch])

  useEffect(() => {
    const consoleElement = consoleRef.current
    if (!consoleElement) return

    consoleElement.scrollTop = consoleElement.scrollHeight
  }, [logs])

  async function startDeploy() {
    if (status === 'running') return
    if (!branchIsValid) {
      setStatus('failed')
      setLogs([
        {
          time: formatTime(),
          stage: 'Deploy',
          level: 'error',
          message:
            'Branch is required and may only contain letters, numbers, ".", "_", "-", and "/".',
        },
      ])
      return
    }

    setStatus('running')
    setRunCount((current) => current + 1)
    setLogs([])

    try {
      const response = await fetch('/api/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branch: branch.trim() }),
      })

      if (!response.ok) {
        throw new Error(await readError(response))
      }

      if (!response.body) {
        throw new Error('Deploy stream is not available.')
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let finalStatus: DeployStatus = 'success'

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          const log = parseLog(line)
          if (!log) continue

          setLogs((current) => [...current, log])

          if (log.status === 'failed') finalStatus = 'failed'
          if (log.status === 'success') finalStatus = 'success'
        }
      }

      buffer += decoder.decode()
      const lastLog = parseLog(buffer)
      if (lastLog) {
        setLogs((current) => [...current, lastLog])
        if (lastLog.status === 'failed') finalStatus = 'failed'
      }

      setStatus(finalStatus)
    } catch (error) {
      setStatus('failed')
      setLogs((current) => [
        ...current,
        {
          time: formatTime(),
          stage: 'Deploy',
          level: 'error',
          message:
            error instanceof Error ? error.message : 'Unable to start deploy.',
        },
      ])
    }
  }

  return (
    <main className="deploy-page px-4 pb-12 pt-12">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="deploy-repo">GIT@GITHUB.COM:HOANGDVHP99/BEOHUB.GIT</p>
          <h1 className="m-0 text-3xl font-extrabold tracking-[0] text-[#111827] sm:text-4xl">
            Beohub Deploy
          </h1>
        </div>
        <span className={`deploy-status deploy-status-${status}`}>
          {deployLabel}
        </span>
      </div>

      <section className="deploy-panel p-5 sm:p-6">
        <div className="mb-7 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="m-0 text-xl font-extrabold text-[#111827]">
            Start Deploy
          </h2>
          <p className="m-0 text-sm font-medium text-[#64748b] sm:text-base">
            Fetch branch, pull latest code, then run Capistrano deploy
          </p>
        </div>

        <div className="space-y-4">
          <label className="block">
            <span className="mb-2 block text-xs font-extrabold text-[#111827]">
              Branch
            </span>
            <input
              className="deploy-input"
              type="text"
              value={branch}
              aria-label="Branch"
              disabled={status === 'running'}
              onChange={(event) => setBranch(event.target.value)}
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-xs font-extrabold text-[#111827]">
              Deploy directory
            </span>
            <input
              className="deploy-input"
              type="text"
              value={deployDirectory}
              aria-label="Deploy directory"
              readOnly
            />
          </label>

          <button
            className="deploy-button"
            type="button"
            disabled={status === 'running'}
            onClick={startDeploy}
          >
            {status === 'running' ? 'Deploying...' : 'Start Deploy'}
          </button>
        </div>
      </section>

      <section className="deploy-panel mt-5 p-5 sm:p-6">
        <div className="mb-5">
          <h2 className="m-0 text-xl font-extrabold text-[#111827]">
            Console Output
          </h2>
          <p className="m-0 text-base font-semibold text-[#64748b]">
            D-{runCount} / {branch.trim() || '-'} / {deployDirectory}
          </p>
        </div>

        <div className="deploy-steps mb-4">
          {steps.map((step, index) => (
            <article className="deploy-step" key={step.name}>
              <span
                className={`deploy-step-dot ${
                  status === 'running' && index > activeStepIndex(logs)
                    ? 'is-waiting'
                    : ''
                }`}
              />
              <h3 className="m-0 text-base font-extrabold text-[#111827]">
                {step.name}
              </h3>
              <p className="m-0 text-base font-semibold text-[#111827]">
                {stepStatus(step.name, logs, status)}
              </p>
            </article>
          ))}
        </div>

        <div
          className="deploy-console"
          aria-label="Deploy console output"
          ref={consoleRef}
        >
          {logs.length ? (
            logs.map((log, index) => (
              <div className="deploy-log-row" key={`${log.stage}-${index}`}>
                <span className="deploy-log-time">{log.time}</span>
                <span className="deploy-log-stage">[{log.stage}]</span>
                <span className={`deploy-log-level is-${log.level}`}>
                  {log.level}
                </span>
                <span className="deploy-log-message">{log.message}</span>
              </div>
            ))
          ) : (
            <div className="deploy-log-row">
              <span className="deploy-log-time">--:--:--</span>
              <span className="deploy-log-stage">[Deploy]</span>
              <span className="deploy-log-level is-info">info</span>
              <span className="deploy-log-message">Ready.</span>
            </div>
          )}
        </div>
      </section>
    </main>
  )
}

function parseLog(line: string): DeployLog | null {
  if (!line.trim()) return null

  try {
    const parsed = JSON.parse(line) as Partial<DeployLog>

    if (
      typeof parsed.time !== 'string' ||
      typeof parsed.stage !== 'string' ||
      typeof parsed.message !== 'string' ||
      !isDeployLevel(parsed.level)
    ) {
      return null
    }

    return {
      time: parsed.time,
      stage: parsed.stage,
      level: parsed.level,
      message: parsed.message,
      status: parsed.status,
    }
  } catch {
    return null
  }
}

function isDeployLevel(level: unknown): level is DeployLog['level'] {
  return level === 'info' || level === 'warn' || level === 'error'
}

async function readError(response: Response) {
  const contentType = response.headers.get('Content-Type') ?? ''

  if (contentType.includes('application/json')) {
    const body = (await response.json()) as { error?: unknown }
    if (typeof body.error === 'string') return body.error
  }

  return response.text()
}

function activeStepIndex(logs: Array<DeployLog>) {
  const commandLogs = logs.filter((log) => log.message.startsWith('$ '))
  if (!commandLogs.length) return -1

  const lastCommand = commandLogs[commandLogs.length - 1]?.message ?? ''
  if (lastCommand.includes('git fetch')) return 0
  if (lastCommand.includes('git checkout')) return 1
  if (lastCommand.includes('git pull')) return 2
  if (lastCommand.includes('bundle exec cap')) return 3

  return -1
}

function stepStatus(
  stepName: string,
  logs: Array<DeployLog>,
  status: DeployStatus,
) {
  if (status === 'failed') return 'Failed'
  if (status === 'success') return 'Done'
  if (status !== 'running') return 'Waiting'

  const current = activeStepIndex(logs)
  const index = steps.findIndex((step) => step.name === stepName)

  if (index < current) return 'Done'
  if (index === current) return 'Running'

  return 'Waiting'
}

function formatTime() {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date())
}
