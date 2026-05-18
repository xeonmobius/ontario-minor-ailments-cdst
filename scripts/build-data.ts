import fs from "fs"
import path from "path"
import { parseAilments } from "../src/lib/parse-ailments"

const sourceDir = path.resolve(__dirname, "../../Ontario-Minor-Ailments-Cards")
const outDir = path.resolve(__dirname, "../data")
const outFile = path.join(outDir, "ailments.json")

fs.mkdirSync(outDir, { recursive: true })
const ailments = parseAilments(sourceDir)
fs.writeFileSync(outFile, JSON.stringify(ailments, null, 2))
console.log(`Parsed ${ailments.length} ailments to ${outFile}`)
