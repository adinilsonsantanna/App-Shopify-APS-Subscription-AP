// app/routes/api.shopify.create-recurring-order.ts

import type { ActionFunctionArgs } from "react-router";
import { unauthenticated } from "../shopify.server";

const INTERNAL_API_KEY = process.env.API_KEY || "";

export const action = async ({
  request,
}: ActionFunctionArgs) => {
  // Deprecated: recurring orders are created by Shopify billing attempts.
  if (process.env.ENABLE_LEGACY_SUBSCRIPTION_FLOW !== "true") {
    return Response.json({ error: "Legacy subscription flow is disabled" }, { status: 410 });
  }

  try {
    // ============================================================
    // MÉTODO
    // ============================================================

    if (request.method !== "POST") {
      return Response.json(
        {
          error: "Method Not Allowed",
        },
        {
          status: 405,
        }
      );
    }

    // ============================================================
    // AUTENTICAÇÃO INTERNA
    // ============================================================

    const apiKey =
      request.headers.get("x-api-key") || "";

    if (
      !INTERNAL_API_KEY ||
      apiKey !== INTERNAL_API_KEY
    ) {
      return Response.json(
        {
          error: "Forbidden",
        },
        {
          status: 403,
        }
      );
    }

    // ============================================================
    // BODY
    // ============================================================

    const body = await request.json();

    const shop = String(
      body.shop || ""
    ).trim();

    const orderInput = body.order;

    if (!shop) {
      return Response.json(
        {
          error: "Shop não informado",
        },
        {
          status: 400,
        }
      );
    }

    if (
      !orderInput ||
      typeof orderInput !== "object"
    ) {
      return Response.json(
        {
          error: "Order input não informado",
        },
        {
          status: 400,
        }
      );
    }

    // ============================================================
    // SHOPIFY ADMIN OFFLINE
    // ============================================================
    //
    // IMPORTANTE:
    // Não usamos mais o accessToken armazenado na API Central.
    //
    // O Shopify App possui a sessão offline e o mecanismo
    // oficial de renovação dos expiring offline tokens.
    //
    // ============================================================

    const {
      admin,
      session,
    } = await unauthenticated.admin(shop);

    if (!session) {
      return Response.json(
        {
          error:
            "Sessão offline da Shopify não encontrada",
          shop,
        },
        {
          status: 401,
        }
      );
    }

    if (session.shop !== shop) {
      return Response.json(
        {
          error:
            "Sessão Shopify não corresponde à loja solicitada",
        },
        {
          status: 403,
        }
      );
    }

    console.log(
      "[Shopify App] Criando pedido recorrente:",
      shop
    );

    // ============================================================
    // GRAPHQL
    // ============================================================

    const response =
      await admin.graphql(
        `#graphql
          mutation orderCreate(
            $order: OrderCreateOrderInput!
          ) {
            orderCreate(order: $order) {
              userErrors {
                field
                message
              }

              order {
                id
                name
                displayFinancialStatus

                totalPriceSet {
                  shopMoney {
                    amount
                    currencyCode
                  }
                }

                customer {
                  id
                  email
                  firstName
                  lastName
                }
              }
            }
          }
        `,
        {
          variables: {
            order: orderInput,
          },
        }
      );

    const result =
      await response.json();

    // ============================================================
    // ERRO HTTP
    // ============================================================

    if (!response.ok) {
      console.error(
        "[Shopify App] GraphQL HTTP error:",
        response.status,
        result
      );

      return Response.json(
        {
          error:
            "Shopify GraphQL HTTP error",
          status: response.status,
          details: result,
        },
        {
          status: 502,
        }
      );
    }

    // ============================================================
    // GRAPHQL ERRORS
    // ============================================================

    if (
      result.errors &&
      result.errors.length > 0
    ) {
      console.error(
        "[Shopify App] GraphQL errors:",
        result.errors
      );

      return Response.json(
        {
          error:
            "Shopify GraphQL error",
          details: result.errors,
        },
        {
          status: 502,
        }
      );
    }

    // ============================================================
    // USER ERRORS
    // ============================================================

    const userErrors =
      result.data
        ?.orderCreate
        ?.userErrors || [];

    if (userErrors.length > 0) {
      console.error(
        "[Shopify App] orderCreate userErrors:",
        userErrors
      );

      return Response.json(
        {
          error:
            "Shopify orderCreate error",
          details: userErrors,
        },
        {
          status: 422,
        }
      );
    }

    // ============================================================
    // PEDIDO
    // ============================================================

    const order =
      result.data
        ?.orderCreate
        ?.order;

    if (!order?.id) {
      console.error(
        "[Shopify App] Shopify não retornou ID do pedido:",
        result
      );

      return Response.json(
        {
          error:
            "Shopify não retornou o ID do pedido",
          details: result,
        },
        {
          status: 502,
        }
      );
    }

    console.log(
      "[Shopify App] ✅ Pedido recorrente criado:",
      order.id
    );

    return Response.json({
      success: true,
      order,
    });
  } catch (error) {
    console.error(
      "[Shopify App] Erro ao criar pedido recorrente:",
      error
    );

    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Erro desconhecido",
      },
      {
        status: 500,
      }
    );
  }
};
