export async function getRecurseData(searchTerm: string, RC_API_KEY: string) {
    const RecurseAPIURL = new URL("https://www.recurse.com/api/v1/profiles")
    RecurseAPIURL.searchParams.set("scope", "current")
    RecurseAPIURL.searchParams.set("limit", "10")
    RecurseAPIURL.searchParams.set("query", searchTerm )
    console.log(RecurseAPIURL.href)

    // fetch RC API
    const response = await fetch(RecurseAPIURL.href, {
        method: "GET",
        headers: {
        "Authorization": `Bearer ${RC_API_KEY}`,
        "Content-Type": "application/json",
        },
    });

    const data = await response.json();
    return data

}




