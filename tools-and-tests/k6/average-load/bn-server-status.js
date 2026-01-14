import {Client, StatusDeadlineExceeded, StatusOK} from 'k6/net/grpc';
import { check, sleep } from 'k6';
import { SharedArray } from 'k6/data';
import {ServerStatusRequest} from "../lib/grpc.js";
import {scenario, vu} from 'k6/execution';


// Configure k6 VUs scheduling and iterations & thresholds
export const options = {
    stages: [
        { duration: '1m', target: 20 }, // traffic ramp-up from 1 to 40 users (all CNs and a shadow MN) over 5 minutes.
        { duration: '1m', target: 40 }, // stay at 100 users for 3 minutes
        { duration: '1m', target: 0 }, // ramp-down to 0 users
    ],
    thresholds: { // todo make these good defaults, we need these to display tags in the result, but also to ping us if they go over
        'grpc_req_duration{name:block_node_server_status}': ['p(95)<300'],
    },
};

// load test configuration data
const data = new SharedArray('BN Test Configs', function () {
    return JSON.parse(open('./../data.json')).configs;
})[0];

// initialize gRPC client
const client = new Client();
client.load([data.protobufPath], 'block-node/api/node_service.proto');

// export function setup() {
//     console.log(`Running setup for: vuIterationInScenario=${vu.iterationInScenario}, vuIterationInInstance=${vu.iterationInInstance} vuIdInTest=${vu.idInTest}, vuIdInInstance=${vu.idInInstance}`)
//     if (vu.iterationInScenario === 0) {
//         client.connect(data.blockNodeUrl, {
//             plaintext: true
//         });
//         console.log(`Connection established: vuIterationInScenario=${vu.iterationInScenario}, vuIterationInInstance=${vu.iterationInInstance} vuIdInTest=${vu.idInTest}, vuIdInInstance=${vu.idInInstance}`)
//     } else {
//         console.log(`Connection is presumably established: vuIterationInScenario=${vu.iterationInScenario}, vuIterationInInstance=${vu.iterationInInstance} vuIdInTest=${vu.idInTest}, vuIdInInstance=${vu.idInInstance}`)
//     }
//     // return { data: res.json() };
// }

// run test
export default () => {
    if (vu.iterationInScenario === 0) {
        client.connect(data.blockNodeUrl, {
            plaintext: true
        });
        console.log(`Connection established: scenarioIterationInTest=${scenario.iterationInTest}, vuIterationInScenario=${vu.iterationInScenario}, vuIterationInInstance=${vu.iterationInInstance} vuIdInTest=${vu.idInTest}, vuIdInInstance=${vu.idInInstance}`)
    } else {
        console.log(`Connection is presumably established: scenarioIterationInTest=${scenario.iterationInTest}, vuIterationInScenario=${vu.iterationInScenario}, vuIterationInInstance=${vu.iterationInInstance} vuIdInTest=${vu.idInTest}, vuIdInInstance=${vu.idInInstance}`)
    }
    const params = {
        tags: {name: 'block_node_server_status'}
    };
    let response = new ServerStatusRequest(client).invoke(params);
    if (response.status === StatusDeadlineExceeded) {
        console.warn(`VU ${vu.idInTest} detected a stale connection (Code 4). Repairing...:  scenarioIterationInTest=${scenario.iterationInTest}, vuIterationInScenario=${vu.iterationInScenario}, vuIterationInInstance=${vu.iterationInInstance} vuIdInTest=${vu.idInTest}, vuIdInInstance=${vu.idInInstance}`);

        client.close(); // Force kill the bad handle
        client.connect(data.blockNodeUrl, { plaintext: true });

        // Re-try immediately on the new connection
        response = new ServerStatusRequest(client).invoke(params);
    }
    if (response.status !== StatusOK) {
        console.log(`gRPC Error Code: ${response.status} (Message: ${response.error.message})`);
        console.log(`gRPC error happened for: scenarioIterationInTest=${scenario.iterationInTest}, vuIterationInScenario=${vu.iterationInScenario}, vuIterationInInstance=${vu.iterationInInstance} vuIdInTest=${vu.idInTest}, vuIdInInstance=${vu.idInInstance}`)
    }
    check(response, {
        'status is OK': (r) => r && r.status === StatusOK,
    });
    sleep(1);
};
