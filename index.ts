import { parseArgs } from "util";
import { getRecurseData } from "./utils/rc-api.ts"


const { values, positionals } = parseArgs({
  args: Bun.argv,
  strict: true,
  allowPositionals: true,
});


const searchTerm = positionals[2]

const RC_API_KEY = process.env.RC_API_KEY

if (!RC_API_KEY) {
    console.log("You need RC API key")
    process.exit()
} 

if (!searchTerm) {
    process.exit()

}

const data = await getRecurseData(searchTerm, RC_API_KEY)
console.log(data);



