# Automatic transaction categories

New Plaid imports are categorized automatically from `personal_finance_category.primary` into the Actual category group `Plaid Auto Categories`.

Existing imported transactions can be categorized from Settings with **Categorize existing transactions**. The operation exports an Actual backup first, retrieves up to two years of Plaid history using PFC v2, matches transactions by stable Plaid imported ID, and updates only category assignments.

The initial broad categories are intended to eliminate manual first-pass categorization. Users may later move transactions or refine Actual rules without affecting synchronization.
