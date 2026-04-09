const { MongoClient } = require('mongodb');

(async () => {
  const client = new MongoClient('mongodb://127.0.0.1:27017');

  try {
    await client.connect();

    const db = client.db('rappidexexpress');

    const docs = await db
      .collection('user_entity')
      .find(
        {
          type: { $in: ['shopkeeper', 'shopkeeperadmin'] },
        },
        {
          projection: {
            _id: 0,
            id: 1,
            name: 1,
            type: 1,
            cityId: 1,
            user: 1,
          },
        },
      )
      .toArray();

    console.log(JSON.stringify(docs, null, 2));
  } catch (error) {
    console.error('Erro ao consultar lojistas:', error);
  } finally {
    await client.close();
  }
})();