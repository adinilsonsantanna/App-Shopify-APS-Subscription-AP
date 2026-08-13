import type { ActionFunctionArgs } from "react-router";
import { unauthenticated } from "../shopify.server";

const INTERNAL_API_KEY = process.env.API_KEY || "";

export const action = async ({ request }: ActionFunctionArgs) => {
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

        const input = body.input;

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
            !input ||
            typeof input !== "object"
        ) {
            return Response.json(
                {
                    error: "Subscription contract input não informado",
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
        //
        // Não usamos accessToken da API Central.
        //
        // O App Shopify recupera a sessão offline da loja e
        // utiliza o mecanismo oficial de renovação dos tokens.
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
            "[Shopify App] Criando subscription contract:",
            shop
        );

        // ============================================================
        // GRAPHQL
        // ============================================================

        const response =
            await admin.graphql(
                `#graphql
          mutation subscriptionContractCreate(
            $input: SubscriptionContractInput!
          ) {
            subscriptionContractCreate(
              input: $input
            ) {
              contract {
                id
                status
                nextBillingDate
              }

              userErrors {
                field
                message
              }
            }
          }
        `,
                {
                    variables: {
                        input,
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
                ?.subscriptionContractCreate
                ?.userErrors || [];

        if (userErrors.length > 0) {
            console.error(
                "[Shopify App] subscriptionContractCreate userErrors:",
                userErrors
            );

            return Response.json(
                {
                    error:
                        "Shopify subscriptionContractCreate error",
                    details: userErrors,
                },
                {
                    status: 422,
                }
            );
        }

        // ============================================================
        // CONTRATO
        // ============================================================

        const contract =
            result.data
                ?.subscriptionContractCreate
                ?.contract;

        if (!contract?.id) {
            console.error(
                "[Shopify App] Shopify não retornou ID do contrato:",
                result
            );

            return Response.json(
                {
                    error:
                        "Shopify não retornou o ID do contrato",
                    details: result,
                },
                {
                    status: 502,
                }
            );
        }

        console.log(
            "[Shopify App] ✅ Subscription contract criado:",
            contract.id
        );

        return Response.json({
            success: true,
            contract,
        });

    } catch (error) {
        console.error(
            "[Shopify App] Erro ao criar subscription contract:",
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