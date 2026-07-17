import { store } from "../server/vectorStore";

export default function handler(req: any, res: any) {
  if (req.method === "GET") {
    res.json({ documents: store.listDocuments() });
  } else if (req.method === "DELETE") {
    store.reset();
    res.json({ ok: true });
  } else {
    res.status(405).send("Method not allowed");
  }
}
