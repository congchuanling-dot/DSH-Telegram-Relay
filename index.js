import { defineTool } from '@deepseek-ai/dsh-tools'

/** A model-callable hello tool for verifying the Telegram relay bundle. */
export const name = 'telegram-relay'
export const inject = ['tools']

/**
 * Registers the `hello_plugin` tool.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - The active Cordis context.
 * @returns {void}
 */
export function apply(ctx) {
  ctx.tools.register(defineTool({
    name: 'telegram-relay',
    description: 'Return a friendly greeting for the supplied name.',
    parameters: {
      name: { type: 'string', required: true, description: 'The person to greet.' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args) {
      return `Hello, ${args.name}!`
    },
    presentCall: args => ({
      card: 'generic',
      title: 'Greet',
      kind: 'other',
      rawInput: args,
    }),
  }))
}
