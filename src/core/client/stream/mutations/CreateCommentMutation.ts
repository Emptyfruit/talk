import { graphql } from "react-relay";
import {
  ConnectionHandler,
  Environment,
  RecordSourceSelectorProxy,
} from "relay-runtime";

import { getMe } from "talk-framework/helpers";
import { TalkContext } from "talk-framework/lib/bootstrap";
import {
  commitMutationPromiseNormalized,
  createMutationContainer,
} from "talk-framework/lib/relay";
import { Omit } from "talk-framework/types";
import { CreateCommentMutation as MutationTypes } from "talk-stream/__generated__/CreateCommentMutation.graphql";

import {
  incrementStoryCommentCounts,
  prependCommentEdgeToProfile,
} from "../helpers";

export type CreateCommentInput = Omit<
  MutationTypes["variables"]["input"],
  "clientMutationId"
>;

function sharedUpdater(
  environment: Environment,
  store: RecordSourceSelectorProxy,
  input: CreateCommentInput
) {
  incrementStoryCommentCounts(store, input.storyID);
  prependCommentEdgeToProfile(
    environment,
    store,
    store.getRootField("createComment")!.getLinkedRecord("edge")!
  );
  addCommentToStory(store, input);
}

/**
 * update integrates new comment into the CommentConnection.
 */
function addCommentToStory(
  store: RecordSourceSelectorProxy,
  input: CreateCommentInput
) {
  // Get the payload returned from the server.
  const payload = store.getRootField("createComment")!;

  // Get the edge of the newly created comment.
  const newEdge = payload.getLinkedRecord("edge")!;

  // Get stream proxy.
  const streamProxy = store.get(input.storyID);
  const connectionKey = "Stream_comments";
  const filters = { orderBy: "CREATED_AT_DESC" };

  if (streamProxy) {
    const con = ConnectionHandler.getConnection(
      streamProxy,
      connectionKey,
      filters
    );
    if (con) {
      ConnectionHandler.insertEdgeBefore(con, newEdge);
    }
  }
}

const mutation = graphql`
  mutation CreateCommentMutation($input: CreateCommentInput!) {
    createComment(input: $input) {
      edge {
        cursor
        node {
          ...StreamContainer_comment @relay(mask: false)
        }
      }
      clientMutationId
    }
  }
`;

let clientMutationId = 0;

function commit(
  environment: Environment,
  input: CreateCommentInput,
  { uuidGenerator }: TalkContext
) {
  const me = getMe(environment)!;
  const currentDate = new Date().toISOString();
  const id = uuidGenerator();
  return commitMutationPromiseNormalized<MutationTypes>(environment, {
    mutation,
    variables: {
      input: {
        storyID: input.storyID,
        body: input.body,
        clientMutationId: clientMutationId.toString(),
      },
    },
    optimisticResponse: {
      createComment: {
        edge: {
          cursor: currentDate,
          node: {
            id,
            createdAt: currentDate,
            author: {
              id: me.id,
              username: me.username,
            },
            body: input.body,
            editing: {
              editableUntil: new Date(Date.now() + 10000),
            },
            actionCounts: {
              reaction: {
                total: 0,
              },
            },
          },
        },
        clientMutationId: (clientMutationId++).toString(),
      },
    } as any, // TODO: (cvle) generated types should contain one for the optimistic response.
    optimisticUpdater: store => {
      sharedUpdater(environment, store, input);
      store.get(id)!.setValue(true, "pending");
    },
    updater: store => {
      sharedUpdater(environment, store, input);
    },
  });
}

export const withCreateCommentMutation = createMutationContainer(
  "createComment",
  commit
);

export type CreateCommentMutation = (
  input: CreateCommentInput
) => Promise<MutationTypes["response"]["createComment"]>;