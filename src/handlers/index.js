import {
  StepFunctionsClient,
  SendTaskSuccessCommand,
  SendTaskFailureCommand,
} from "@aws-sdk/client-sfn";
import {
  DynamoDBClient,
  QueryCommand,
  UpdateItemCommand,
  GetItemCommand,
} from "@aws-sdk/client-dynamodb";

const region = process.env.AWS_REGION || "us-east-1";
const stepFunctionsClient = new StepFunctionsClient({ region });
const dynamoDBClient = new DynamoDBClient({ region });

const USER_TABLE = process.env.USER_TABLE || "";
const BOOK_TABLE = process.env.BOOK_TABLE || "";

const isBookAvailable = (book, quantity) => {
  return book.quantity - quantity > 0;
};

export const checkInventory = async ({ bookId, quantity }) => {
  try {
    const params = {
      TableName: BOOK_TABLE,
      KeyConditionExpression: "bookId = :bookId",
      ExpressionAttributeValues: {
        ":bookId": { S: bookId },
      },
    };
    const result = await dynamoDBClient.send(new QueryCommand(params));
    const book = result.Items[0];
    console.log("checkInventory book: ", book);

    if (isBookAvailable(book, quantity)) {
      return book;
    } else {
      const bookOutOfStockError = new Error("The book is out of stock");
      bookOutOfStockError.name = "BookOutOfStock";
      throw bookOutOfStockError;
    }
  } catch (e) {
    if (e.name === "BookOutOfStock") {
      throw e;
    } else {
      const bookNotFoundError = new Error(e);
      bookNotFoundError.name = "BookNotFound";
      throw bookNotFoundError;
    }
  }
};

export const calculateTotal = async ({ book, quantity }) => {
  console.log("book: ", book);
  const total = book.price * quantity;
  return { total };
};

export const billCustomer = async (params) => {
  console.log(params);
  // throw 'Error in billing'
  /* Bill the customer e.g. Using Stripe token from the paramerters */
  return "Successfully Billed";
};

const deductPoints = async (userId) => {
  const params = {
    TableName: USER_TABLE,
    Key: { userId: { S: userId } },
    UpdateExpression: "set points = :zero",
    ExpressionAttributeValues: {
      ":zero": { N: "0" },
    },
  };
  await dynamoDBClient.send(new UpdateItemCommand(params));
};

const updateBookQuantity = async (bookId, orderQuantity) => {
  console.log("bookId: ", bookId);
  console.log("orderQuantity: ", orderQuantity);
  const params = {
    TableName: BOOK_TABLE,
    Key: { bookId: { S: bookId } },
    UpdateExpression: "SET quantity = quantity - :orderQuantity",
    ExpressionAttributeValues: {
      ":orderQuantity": { N: orderQuantity.toString() },
    },
  };
  await dynamoDBClient.send(new UpdateItemCommand(params));
};

export const redeemPoints = async ({ userId, total }) => {
  console.log("userId: ", userId);
  let orderTotal = total.total;
  console.log("orderTotal:", orderTotal);
  try {
    const params = {
      TableName: USER_TABLE,
      Key: {
        userId: { S: userId },
      },
    };
    const result = await dynamoDBClient.send(new GetItemCommand(params));
    const user = result.Item;
    console.log("user: ", user);
    const points = user.points.N;
    console.log("points: ", points);
    if (orderTotal > points) {
      await deductPoints(userId);
      orderTotal = orderTotal - points;
      return { total: orderTotal, points };
    } else {
      throw new Error("Order total is less than redeem points");
    }
  } catch (e) {
    throw new Error(e);
  }
};

export const restoreRedeemPoints = async ({ userId, total }) => {
  try {
    if (total.points) {
      const params = {
        TableName: USER_TABLE,
        Key: { userId: { S: userId } },
        UpdateExpression: "set points = :points",
        ExpressionAttributeValues: {
          ":points": { N: total.points.toString() },
        },
      };
      await dynamoDBClient.send(new UpdateItemCommand(params));
    }
  } catch (e) {
    throw new Error(e);
  }
};

export const sqsWorker = async (event) => {
  try {
    console.log(JSON.stringify(event));
    const record = event.Records[0];
    const body = JSON.parse(record.body);
    console.log("sqs worker body: ", body);
    /** Find a courier and attach courier information to the order */
    const courier = "alfio.martini@encora.com";

    // update book quantity
    await updateBookQuantity(body.Input.bookId, body.Input.quantity);

    // throw "Something wrong with Courier API";

    // Attach courier information to the order
    await stepFunctionsClient.send(
      new SendTaskSuccessCommand({
        output: JSON.stringify({ courier }),
        taskToken: body.Token,
      })
    );
  } catch (e) {
    console.log("===== You got an Error =====");
    console.log(e);
    await stepFunctionsClient.send(
      new SendTaskFailureCommand({
        error: "NoCourierAvailable",
        cause: "No couriers are available",
        taskToken: body.Token,
      })
    );
  }
};

export const restoreQuantity = async ({ bookId, quantity }) => {
  const params = {
    TableName: BOOK_TABLE,
    Key: { bookId: { S: bookId } },
    UpdateExpression: "set quantity = quantity + :orderQuantity",
    ExpressionAttributeValues: {
      ":orderQuantity": { N: quantity.toString() },
    },
  };
  await dynamoDBClient.send(new UpdateItemCommand(params));
  return "Quantity restored";
};