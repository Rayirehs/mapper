import { MongoClient, type Db } from 'mongodb';

let client: MongoClient | null = null;

export async function getDb(
  uri = process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017',
  dbName = process.env.MONGODB_DB ?? 'rates_br',
): Promise<Db> {
  if (!client) {
    client = new MongoClient(uri);
    await client.connect();
  }
  return client.db(dbName);
}

export async function closeDb(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
  }
}
