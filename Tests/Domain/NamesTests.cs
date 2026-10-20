using api_v2.Domain.Rules;
using Xunit;

namespace api_v2.Tests.Domain;

// The one name rule, held to the same pairs as angular's name-key.spec.ts. The database's
// name_rule collation is checked against them by check_names.py.
public sealed class NamesTests
{
    public static TheoryData<string, string, bool> Pairs => new()
    {
        { "Acme, Inc.", "acme-inc", true },
        { "Ácmé Inc", "ACME inc", true },
        { "ali.k", "ali_k", true },
        { "काम", "कम", false },
        { "ΟΔΟΣ", "οδος", true },
        { "İzmir", "izmir", true },
        { "Acme 1", "Acme 2", false },
        { "Sales 2", "sales. (2)", true },
        { "شركة", "شَرِكة", true },
        { "Ｆｕｌｌ", "full", true },
        { "a+b", "ab", true },
        { "$Cash", "cash", true },
        { "𠀀𠀁", "𠀀𠀂", false },
        { "Café", "Cafe", true },
        { "straße", "strasse", true },
        { "Zero​Width", "zerowidth", true },
    };

    [Theory]
    [MemberData(nameof(Pairs))]
    public void Two_names_are_one_exactly_when_the_rule_says(string a, string b, bool same)
    {
        Assert.Equal(same, Names.Same(a, b));
        // The key is what the unique checks compare, so it must agree with Same
        Assert.Equal(same, Names.Key(a) == Names.Key(b));
    }

    [Fact]
    public void A_name_of_only_symbols_has_no_letters()
    {
        Assert.True(Names.HasNoLetters("!!!"));
        Assert.False(Names.HasNoLetters("a!"));
    }
}
