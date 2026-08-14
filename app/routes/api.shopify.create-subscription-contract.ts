import type { ActionFunctionArgs } from "react-router";
import { unauthenticated } from "../shopify.server";
import { getShopifyGraphqlErrors } from "../lib/graphql-response.server";

const INTERNAL_API_KEY = process.env.API_KEY || "";

export const action = async ({ request }: ActionFunctionArgs) => {
    // Deprecated: contracts are created by Shopify after native checkout.
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
        const createGraphqlErrors = getShopifyGraphqlErrors(createResult);

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
            createGraphqlErrors.length > 0
        ) {
            console.error(
                "[Shopify App] GraphQL errors:",
                createGraphqlErrors
            );

            return Response.json(
                {
                    error:
                        "Shopify GraphQL error",
                    details:
                        createGraphqlErrors,
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
            const rawProductVariantId =
                String(
                    line.productVariantId ||
                    ""
                ).trim();

            if (!rawProductVariantId) {
                console.warn(
                    "[Shopify App] Linha ignorada: productVariantId ausente"
                );

                continue;
            }

            const productVariantId =
                rawProductVariantId.startsWith(
                    "gid://shopify/ProductVariant/"
                )
                    ? rawProductVariantId
                    : `gid://shopify/ProductVariant/${rawProductVariantId}`;

            const quantity =
                Number(
                    line.quantity || 1
                );

            const currentPrice =
                String(
                    line.currentPrice || "0"
                );

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
            const lineGraphqlErrors = getShopifyGraphqlErrors(lineResult);

            // ========================================================
            // GRAPHQL ERROR
            // ========================================================

            if (
                !lineResponse.ok ||
                lineGraphqlErrors.length > 0
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
        // COMMIT DO SUBSCRIPTION DRAFT
        // ============================================================
        //
        // O checkout inicial já foi realizado pela Shopify.
        // A partir daqui finalizamos o Subscription Contract nativo
        // da Shopify. Não usamos Stripe neste fluxo.
        //
        // ============================================================

        console.log(
            "[Shopify App] Finalizando subscription draft:",
            draft.id
        );

        const commitResponse =
            await admin.graphql(
                `#graphql
                mutation subscriptionDraftCommit(
                    $draftId: ID!
                ) {
                    subscriptionDraftCommit(
                        draftId: $draftId
                    ) {
                        contract {
                            id
                            status
                            nextBillingDate
                            customer {
                                id
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
                        draftId: draft.id,
                    },
                }
            );

        const commitResult =
            await commitResponse.json();
        const commitGraphqlErrors = getShopifyGraphqlErrors(commitResult);

        if (
            !commitResponse.ok ||
            commitGraphqlErrors.length > 0
        ) {
            console.error(
                "[Shopify App] Erro GraphQL ao finalizar subscription draft:",
                commitResult
            );

            return Response.json(
                {
                    error:
                        "Erro Shopify ao finalizar assinatura",
                    details:
                        commitResult,
                    draftId:
                        draft.id,
                },
                {
                    status: 502,
                }
            );
        }

        const commitUserErrors =
            commitResult
                .data
                ?.subscriptionDraftCommit
                ?.userErrors || [];

        if (
            commitUserErrors.length > 0
        ) {
            console.error(
                "[Shopify App] subscriptionDraftCommit userErrors:",
                commitUserErrors
            );

            return Response.json(
                {
                    error:
                        "Erro ao finalizar assinatura Shopify",
                    details:
                        commitUserErrors,
                    draftId:
                        draft.id,
                },
                {
                    status: 422,
                }
            );
        }

        const committedContract =
            commitResult
                .data
                ?.subscriptionDraftCommit
                ?.contract;

        if (!committedContract?.id) {
            console.error(
                "[Shopify App] Shopify não retornou o Subscription Contract:",
                commitResult
            );

            return Response.json(
                {
                    error:
                        "Shopify não retornou o Subscription Contract",
                    details:
                        commitResult,
                    draftId:
                        draft.id,
                },
                {
                    status: 502,
                }
            );
        }

        console.log(
            "[Shopify App] ✅ Subscription Contract criado:",
            committedContract.id
        );

        return Response.json({
            success: true,

            contract: {
                id:
                    committedContract.id,
                status:
                    committedContract.status,
                nextBillingDate:
                    committedContract.nextBillingDate,
            },

            draft: {
                id: draft.id,
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
