import Docker from 'dockerode'
import config from './config';

const docker = new Docker({ socketPath: config.dockerSocketPath });

async function info() {
    const containers = await docker.listContainers();
    console.log(JSON.stringify(containers, null, 2));
}

info().catch(console.error);
