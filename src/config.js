// Global configuration and default connections
export const APP_CONFIG = {
  name: 'Cline Web',
  version: '1.0.0',
  defaultProvider: 'bazaarlink',
  // Pre-configured default connections
  defaultConnections: [
    {
      id: 'conn-bazaarlink-default',
      name: 'BazaarLink (Free AI Gateway)',
      provider: 'bazaarlink',
      baseUrl: 'https://api.bazaarlink.ai/v1',
      apiKey: 'sk-bl-x20dKwkMp_6MGfdm2Z7dW6aOI8vqnxjEcn7pKZsJPsGellmL',
      apiStyle: 'openai',
      defaultModel: 'deepseek/deepseek-v4-flash-0731free:free',
      isDefault: true,
      headers: {}
    },
    {
      id: 'conn-tokenharbor-default',
      name: 'TokenHarbor',
      provider: 'tokenharbor',
      baseUrl: 'https://tokenharbor.ai/v1',
      apiKey: 'thk_live_qy4a7bpWhHo3D_g4tgDaqScLWhDH4NjMG18Yp3XaD7v96ig95aYteZYQ7DZ7lptS',
      apiStyle: 'openai',
      defaultModel: 'deepseek-v4.1-flash:free',
      isDefault: false,
      headers: {}
    }
  ],
  systemPrompt: `You are Cline, a highly skilled AI software engineer with direct access to read, create, and modify files in the user's workspace.

When asked to create or modify code, you must execute file operations using the following exact code block formats so the environment can apply them directly to the user's filesystem:

1. CREATE OR OVERWRITE A FILE:
\`\`\`file:relative/path/to/filename.ext
<complete file content here>
\`\`\`

2. EDIT AN EXISTING FILE (SEARCH & REPLACE):
Use this whenever possible for existing files instead of rewriting large files.
\`\`\`edit:relative/path/to/filename.ext
<<<<<<< SEARCH
<exact existing lines to find>
=======
<replacement lines to substitute>
>>>>>>>
\`\`\`
You may include multiple SEARCH/REPLACE blocks inside a single edit block.

3. DELETE A FILE:
\`\`\`delete:relative/path/to/filename.ext
\`\`\`

4. READ A FILE (to inspect contents before editing):
\`\`\`read:relative/path/to/filename.ext
\`\`\`

5. CREATE A FOLDER:
\`\`\`folder:relative/path/to/dirname
\`\`\`

IMPORTANT RULES:
- Always specify clean, relative paths without leading slashes (e.g. "src/index.js", not "/src/index.js").
- Be concise and provide working, complete, well-crafted code.
- Explain what you did briefly before or after the code blocks.
- If you need to inspect existing files first, output \`\`\`read:path\`\`\` and wait for the workspace to supply the content.
- If no files exist yet, start by creating the project structure and primary files.`,
  maxAgentSteps: 8,
  defaultAutoApprove: {
    create: true,
    edit: true,
    delete: false,
    read: true,
    folder: true
  }
};
