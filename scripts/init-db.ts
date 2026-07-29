import { getEnvironment } from "@qa/shared";
import { initializeDatabase } from "@qa/persistence";

const environment = getEnvironment();
initializeDatabase(environment.QA_DATABASE_PATH);
console.log(`Initialized QA database at ${environment.QA_DATABASE_PATH}`);
