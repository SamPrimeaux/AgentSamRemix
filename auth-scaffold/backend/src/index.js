import { handleIdentityWorkerRequest } from '@inneranimalmedia/agentsam-sdk/identity/server/worker-router';

export default {
  async fetch(request, env, ctx) {
    return handleIdentityWorkerRequest(request, env);
  },
};
