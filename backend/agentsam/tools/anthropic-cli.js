/**
 * Tool: Anthropic CLI Bridge
 * Bridges Agent Sam to the 'ant' command-line tool.
 * Enables terminal-based model exploration, agent management, and session streaming.
 */

import { handlers as termHandlers } from './terminal.js';

export const handlers = {
    /**
     * Executes an 'ant' CLI command.
     * Example: ant messages create --model claude-opus-4-8 --message 'Hello'
     */
    anthropic_cli: async ({ command, format = 'json' }, env) => {
        if (!command) throw new Error('No ant command provided');
        
        // Ensure we are using the 'ant' binary
        const fullCommand = `ant ${command} --format ${format}`;
        
        console.log(`[Anthropic CLI] Executing: ${fullCommand}`);
        
        // Route through the terminal executor for session consistency
        return await termHandlers.run_command({ command: fullCommand }, env);
    },

    /**
     * Specialized: Upload file to Anthropic via CLI
     */
    anthropic_cli_upload: async ({ filePath, description }, env) => {
        if (!filePath) throw new Error('filePath required for CLI upload');
        const cmd = `beta:files upload --file ${filePath}`;
        return await termHandlers.run_command({ command: `ant ${cmd} --format json` }, env);
    }
};
