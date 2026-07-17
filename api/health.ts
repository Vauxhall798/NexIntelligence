export default function handler(req: any, res: any) {
  res.json({ test: "API is working", timestamp: new Date().toISOString() });
}
