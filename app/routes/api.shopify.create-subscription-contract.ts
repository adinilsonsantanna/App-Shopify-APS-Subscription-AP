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
                    error:
                        "Subscription contract input não informado",
                },
                {
                    status: 400,
                }
            );
        }

        // ============================================================
        // VALIDAR DADOS PRINCIPAIS
        // ============================================================

        const rawCustomerId =
            String(input.customerId || "").trim();

        const customerId =
            rawCustomerId.startsWith("gid://shopify/Customer/")
                ? rawCustomerId
                : `gid://shopify/Customer/${rawCustomerId}`;

        const currencyCode =
            String(
                input.currencyCode || "BRL"
            ).toUpperCase();

        const nextBillingDate =
            input.nextBillingDate;

        if (!customerId) {
            return Response.json(
                {
                    error:
                        "customerId não informado",
                },
                {
                    status: 400,
                }
            );
        }

        if (!nextBillingDate) {
            return Response.json(
                {
                    error:
                        "nextBillingDate não informado",
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
        // O APP Shopify recupera a sessão offline da loja.
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

        console.log(
            "[Shopify App] Dados recebidos:",
            JSON.stringify(
                {
                    customerId,
                    currencyCode,
                    nextBillingDate,
                    billingPolicy:
                        input.billingPolicy,
                    deliveryPolicy:
                        input.deliveryPolicy,
                    lines:
                        input.lines,
                },
                null,
                2
            )
        );

        // ============================================================
        // PREPARAR CONTRACT
        // ============================================================
        //
        // Shopify 2026-07:
        //
        // billingPolicy e deliveryPolicy pertencem
        // ao objeto "contract".
        //
        // As linhas NÃO são enviadas aqui.
        //
        // Elas serão adicionadas posteriormente através
        // de subscriptionDraftLineAdd.
        //
        // ============================================================

        const billingPolicy = {
            interval: String(
                input.billingPolicy?.interval || "MONTH"
            ).toUpperCase(),
            intervalCount: Number(
                input.billingPolicy?.intervalCount || 1
            ),
        };

        const deliveryPolicy = {
            interval: String(
                input.deliveryPolicy?.interval || "MONTH"
            ).toUpperCase(),
            intervalCount: Number(
                input.deliveryPolicy?.intervalCount || 1
            ),
        };

        const contract: Record<string, any> = {
            status: "ACTIVE",

            billingPolicy,

            deliveryPolicy,
        };

        // ============================================================
        // GRAPHQL — CREATE DRAFT
        // ============================================================

        const createResponse =
            await admin.graphql(
                `#graphql
                mutation createSubscriptionContract(
                    $input: SubscriptionContractCreateInput!
                ) {
                    subscriptionContractCreate(
                        input: $input
                    ) {
                        draft {
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
                        input: {
                            customerId,
                            currencyCode,
                            nextBillingDate,
                            contract,
                        },
                    },
                }
            );

        const createResult =
            await createResponse.json();

        // ============================================================
        // ERRO HTTP
        // ============================================================

        if (!createResponse.ok) {
            console.error(
                "[Shopify App] GraphQL HTTP error:",
                createResponse.status,
                createResult
            );

            return Response.json(
                {
                    error:
                        "Shopify GraphQL HTTP error",
                    status:
                        createResponse.status,
                    details:
                        createResult,
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
            createResult.errors &&
            createResult.errors.length > 0
        ) {
            console.error(
                "[Shopify App] GraphQL errors:",
                createResult.errors
            );

            return Response.json(
                {
                    error:
                        "Shopify GraphQL error",
                    details:
                        createResult.errors,
                },
                {
                    status: 502,
                }
            );
        }

        // ============================================================
        // USER ERRORS
        // ============================================================

        const createUserErrors =
            createResult
                .data
                ?.subscriptionContractCreate
                ?.userErrors || [];

        if (
            createUserErrors.length > 0
        ) {
            console.error(
                "[Shopify App] subscriptionContractCreate userErrors:",
                createUserErrors
            );

            return Response.json(
                {
                    error:
                        "Shopify subscriptionContractCreate error",
                    details:
                        createUserErrors,
                },
                {
                    status: 422,
                }
            );
        }

        // ============================================================
        // DRAFT
        // ============================================================

        const draft =
            createResult
                .data
                ?.subscriptionContractCreate
                ?.draft;

        if (!draft?.id) {
            console.error(
                "[Shopify App] Shopify não retornou ID do draft:",
                createResult
            );

            return Response.json(
                {
                    error:
                        "Shopify não retornou o ID do subscription draft",
                    details:
                        createResult,
                },
                {
                    status: 502,
                }
            );
        }

        console.log(
            "[Shopify App] ✅ Subscription draft criado:",
            draft.id
        );

        // ============================================================
        // ADICIONAR LINHAS
        // ============================================================

        const lines =
            Array.isArray(input.lines)
                ? input.lines
                : [];

        for (
            const line of lines
        ) {
            const productVariantId =
                String(
                    line.productVariantId ||
                    ""
                ).trim();

            const quantity =
                Number(
                    line.quantity || 1
                );

            const currentPrice =
                String(
                    line.currentPrice || "0"
                );

            if (
                !productVariantId
            ) {
                console.warn(
                    "[Shopify App] Linha ignorada: productVariantId ausente"
                );

                continue;
            }

            console.log(
                "[Shopify App] Adicionando linha ao draft:",
                {
                    productVariantId,
                    quantity,
                    currentPrice,
                }
            );

            const lineResponse =
                await admin.graphql(
                    `#graphql
                    mutation subscriptionDraftLineAdd(
                        $draftId: ID!
                        $input: SubscriptionLineInput!
                    ) {
                        subscriptionDraftLineAdd(
                            draftId: $draftId
                            input: $input
                        ) {
                            draft {
                                id
                            }

                            lineAdded {
                                id
                                quantity
                                currentPrice {
                                    amount
                                    currencyCode
                                }
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
                            draftId:
                                draft.id,

                            input: {
                                productVariantId,
                                quantity,
                                currentPrice,
                            },
                        },
                    }
                );

            const lineResult =
                await lineResponse.json();

            // ========================================================
            // GRAPHQL ERROR
            // ========================================================

            if (
                !lineResponse.ok ||
                lineResult.errors?.length
            ) {
                console.error(
                    "[Shopify App] Erro GraphQL ao adicionar linha:",
                    lineResult
                );

                return Response.json(
                    {
                        error:
                            "Erro Shopify ao adicionar linha da assinatura",
                        details:
                            lineResult,
                        draftId:
                            draft.id,
                    },
                    {
                        status: 502,
                    }
                );
            }

            // ========================================================
            // USER ERRORS
            // ========================================================

            const lineUserErrors =
                lineResult
                    .data
                    ?.subscriptionDraftLineAdd
                    ?.userErrors || [];

            if (
                lineUserErrors.length > 0
            ) {
                console.error(
                    "[Shopify App] subscriptionDraftLineAdd userErrors:",
                    lineUserErrors
                );

                return Response.json(
                    {
                        error:
                            "Erro ao adicionar linha da assinatura",
                        details:
                            lineUserErrors,
                        draftId:
                            draft.id,
                    },
                    {
                        status: 422,
                    }
                );
            }

            console.log(
                "[Shopify App] ✅ Linha adicionada:",
                lineResult
                    .data
                    ?.subscriptionDraftLineAdd
                    ?.lineAdded
                    ?.id
            );
        }

        // ============================================================
        // RESULTADO
        // ============================================================
        //
        // ATENÇÃO:
        //
        // subscriptionContractCreate cria um DRAFT.
        //
        // Não fazemos subscriptionDraftCommit aqui porque
        // nossa cobrança recorrente é feita pelo Stripe.
        //
        // O draft fica disponível para o fluxo da assinatura.
        //
        // ============================================================

        console.log(
            "[Shopify App] ✅ Subscription draft preparado:",
            draft.id
        );

        return Response.json({
            success: true,

            contract: {
                id: draft.id,
            },

            draft: {
                id: draft.id,
                status: draft.status,
                nextBillingDate:
                    draft.nextBillingDate,
            },
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