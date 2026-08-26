type Field = {
    name: string;
    type: "string" | "number" | "walletRevAddr" | "MasterURI" | "set" | "uri";
};

function str_field(name: string): Field {
    return { name, type: "string" };
}

function num_field(name: string): Field {
    return { name, type: "number" };
}

function rev_field(name: string): Field {
    return { name, type: "walletRevAddr" };
}

function master_uri_field(name: string): Field {
    return { name, type: "MasterURI" };
}

function set_field(name: string): Field {
    return { name, type: "set" };
}

function uri_field(name: string): Field {
    return { name, type: "uri" };
}

function prepare_arg(value: string, type: Field["type"]): string {
    switch (type) {
        case "walletRevAddr":
        case "string":
            return JSON.stringify(value);

        case "number":
            return value;

        case "uri":
        case "MasterURI":
            return "`" + value + "`";

        case "set":
            return `Set(${value})`;
    }
}

export type Snippet = {
    code: string;
    fields: Field[];
};

export function snippet_apply(name: keyof typeof snippets, args: Array<string|null>) {
    const snippet = snippets[name];
    const code = snippet.code.split("\n").map(l => `  ${l}`).join("\n");

    let prepared_args: string[] = [];

    for (let i=0; i<snippet.fields.length; i++) {
        let val = args[i] ?? "";
        prepared_args.push(prepare_arg(val, snippet.fields[i].type));
    }

    let arg_str = prepared_args.join(", ");
    return `match [${arg_str}] {\n` + code + "\n}";
}

export const snippets = {
    blank: {
        code: "",
        fields: []
    },
    checkBalance: {
        code:
            "[myGovRevAddr] => {\n" +
            "  new    // use Explore to see result at return\n" +
            "  return,\n" +
            "  lookup(`rho:registry:lookup`),\n" +
            "  RevVaultCh,\n" +
            "  vaultCh,\n" +
            "  balanceCh\n" +
            "  in {\n" +
            "    lookup!(`rho:rchain:revVault`, *RevVaultCh) |\n" +
            "    for (@(_, RevVault) <- RevVaultCh) {\n" +
            '      @RevVault!("findOrCreate", myGovRevAddr, *vaultCh) |\n' +
            "      for (@(true, vault) <- vaultCh) {\n" +
            '        @vault!("balance", *balanceCh) |\n' +
            "        for (@balance <- balanceCh) {\n" +
            '          return!(["#define", "$myBalance", balance])|\n' +
            '          return!("${rev}.${fraction}" %% {\n' +
            '            "rev": balance/100000000,\n' +
            '            "fraction": ("${num}"%%{\n' +
            '              "num": balance%100000000+100000000}).slice(1,9)\n' +
            "            }\n" +
            "            )\n" +
            "          }\n" +
            "        }\n" +
            "      }\n" +
            "    }\n" +
            "  }\n" +
            "",
        fields: [rev_field("myGovRevAddr")]
    },
    transfer: {
        code:
            "[revAddrFrom, revAddrTo, amount] => {\n" +
            "  new rl(`rho:registry:lookup`), RevVaultCh in {\n" +
            "    rl!(`rho:rchain:revVault`, *RevVaultCh) |\n" +
            "    for (@(_, RevVault) <- RevVaultCh) {\n" +
            "      new vaultCh, vaultTo, revVaultkeyCh,\n" +
            "      deployerId(`\n" +
            "      rho:rchain:deployerId`),\n" +
            "      deployId(`\n" +
            "      rho:rchain:deployId`)\n" +
            "      in {\n" +
            '        @RevVault!("findOrCreate", revAddrFrom, *vaultCh) |\n' +
            '        @RevVault!("findOrCreate", revAddrTo, *vaultTo) |\n' +
            '        @RevVault!("deployerAuthKey", *deployerId, *revVaultkeyCh) |\n' +
            "        for (@vault <- vaultCh; key <- revVaultkeyCh; _ <- vaultTo) {\n" +
            "          match vault {\n" +
            "            (true, vault) => {\n" +
            "              new resultCh in {\n" +
            '                @vault!("transfer", revAddrTo, amount, *key, *resultCh) |\n' +
            "                for (@result <- resultCh) {\n" +
            "                  match result {\n" +
            '                    (true , _ ) => deployId!((true, "Transfer successful (not yet finalized)."))\n' +
            "                    (false, err) => deployId!((false, err))\n" +
            "                  }\n" +
            "                }\n" +
            "              }\n" +
            "            }\n" +
            "            err => {\n" +
            '              deployId!((false, "REV vault cannot be found or created."))\n' +
            "            }\n" +
            "          }\n" +
            "        }\n" +
            "      }\n" +
            "    }\n" +
            "  }\n" +
            "}",
        fields: [rev_field("revAddrFrom"), str_field("revAddrTo"), num_field("amount")]
    },
    sequencialLooping: {
        code:
            "[] => {\n" +
            "  new output, num, increaseByNum, increase, currentCount in {\n" +
            "    currentCount!(0) |\n" +
            "    contract increase(ack) = {\n" +
            "      for(old <- currentCount) {\n" +
            "        currentCount!(*old + 1) |\n" +
            "        ack!(*old)\n" +
            "      }\n" +
            "    } |\n" +
            "    contract increaseByNum(num, ack) = {\n" +
            "      // output!(*num) |\n" +
            "      match *num {\n" +
            "        0 => {\n" +
            '          output!("Recursion finished.") |\n' +
            "          ack!(Nil)\n" +
            "        }\n" +
            "        _ => {\n" +
            "          new kiril in {\n" +
            "            for (k <- kiril) { ack!(Nil) } |\n" +
            "            output!(*num) |\n" +
            "            increase!(*num) |\n" +
            "            increaseByNum!(*num-1, *kiril)\n" +
            "          }\n" +
            "        }\n" +
            "      }\n" +
            "    } |\n" +
            "    new finished in {\n" +
            "      increaseByNum!(500, *finished) |\n" +
            "      for (_ <- finished) {\n" +
            "        for (cc <- currentCount) {\n" +
            '          output!({"Current count": *cc})\n' +
            "        }\n" +
            "      }\n" +
            "    }\n" +
            "  }\n" +
            "}",
        fields: []
    },
    newInbox: {
        code:
            "[ReadcapURI] => {\n" +
            "  new\n" +
            "  stdout(`rho:io:stdout`),\n" +
            "  deployId(`rho:rchain:deployId`),\n" +
            "  deployerId(`rho:rchain:deployerId`),\n" +
            "  masterLookupCh,\n" +
            "  inboxCaps,\n" +
            "  directoryCaps,\n" +
            "  lookupCh,\n" +
            "  lookup(`rho:registry:lookup`),\n" +
            "  ret\n" +
            "  in {\n" +
            "    lookup!(ReadcapURI, *masterLookupCh) |\n" +
            "    for (lookup_Master <- masterLookupCh) {\n" +
            '      stdout!({"master-dictionary dictionary unforgeable": *lookup_Master}) |\n' +
            '      lookup_Master!("GetMe", *lookupCh) |\n' +
            "      for (GetMe <- lookupCh) {\n" +
            '        stdout!({"master-dictionary GetMe unforgeable": *GetMe}) |\n' +
            "        GetMe!(*deployerId, *ret, *stdout) |\n" +
            "        for (@(success, (claimed, mystuff)) <- ret) {\n" +
            '          stdout!(["getme returns", success, claimed, mystuff]) |\n' +
            "          if (claimed == false) {\n" +
            '            @[*deployerId, "dictionary"]!(mystuff.get("dictionary")) |\n' +
            '            @[*deployerId, "inbox"]!(mystuff.get("inbox"))\n' +
            "          } |\n" +
            '          deployId!(["mystuff", mystuff])\n' +
            "        }\n" +
            "      }\n" +
            "    }\n" +
            "  }\n" +
            "}",
        fields: [master_uri_field("ReadcapURI")]
    },
    peekInbox: {
        code:
            "[lockerTag, type, subtype] => {\n" +
            "  new\n" +
            "  //                 type and subtype are optional\n" +
            "  deployId(`rho:rchain:deployId`),\n" +
            "  deployerId(`rho:rchain:deployerId`),\n" +
            "  ch\n" +
            "  in {\n" +
            '    for(@{"peek": *peek, "URI": uri ..._} <<- @[*deployerId, lockerTag]) {\n' +
            '      deployId!({"URI": uri}) |\n' +
            '      if (type == "" ) {\n' +
            "        peek!(*deployId)\n" +
            '      } else if (subtype == "" ) {\n' +
            "        peek!(type,*deployId)\n" +
            "      }  else {\n" +
            "        peek!(type,subtype,*deployId)\n" +
            "      }\n" +
            "    }\n" +
            "  }\n" +
            "}",
        fields: [str_field("lockerTag"), str_field("type"), str_field("subtype")]
    },
    receiveFromInbox: {
        code:
            "[lockerTag, type, subtype] => {\n" +
            "  new\n" +
            "  //                 type and subtype are optional\n" +
            "  deployId(`rho:rchain:deployId`),\n" +
            "  deployerId(`rho:rchain:deployerId`),\n" +
            "  ch\n" +
            "  in {\n" +
            '    for(@{"receive": *receive, "URI": uri ..._} <<- @[*deployerId, lockerTag]) {\n' +
            '      deployId!({"URI": uri}) |\n' +
            '      if (type == "" ) {\n' +
            "        receive!(*deployId)\n" +
            '      } else if (subtype == "" ) {\n' +
            "        receive!(type,*deployId)\n" +
            "      }  else {\n" +
            "        receive!(type,subtype,*deployId)\n" +
            "      }\n" +
            "    }\n" +
            "  }\n" +
            "}",
        fields: [str_field("lockerTag"), str_field("type"), str_field("subtype")]
    },
    createInboxandCastVote: {
        code:
            "[ReadcapURI] => {\n" +
            "}",
        fields: [master_uri_field("ReadcapURI")]
    },
    newChat: {
        code:
            "[channel] => {\n" +
            "  new\n" +
            "  trace,\n" +
            "  lookupCh,\n" +
            "  bCh,\n" +
            "  ch1,\n" +
            "  ret,\n" +
            "  listener,\n" +
            "  lookup(`rho:registry:lookup`),\n" +
            "  return(`rho:rchain:deployId`),\n" +
            "  deployerId(`rho:rchain:deployerId`) in {\n" +
            '    for (@{"read": *MCA, ..._} <<- @[*deployerId, "dictionary"]) {\n' +
            '      return!(["MCA", *MCA]) |\n' +
            '      MCA!("Chat", *lookupCh)\n' +
            "    } |\n" +
            "    for(Chat <- lookupCh) {\n" +
            '      return!(["Chat", *Chat]) |\n' +
            "      Chat!(*bCh) |\n" +
            "      for(pub, sub, isend <- bCh) {\n" +
            '        for (@{"inbox": *inbox, "URI": uri ..._} <<- @[*deployerId, "inbox"]) {\n' +
            '          return!(["chatAdmin", channel, { "pub": *pub, "sub": *sub, "isend": *isend }]) |\n' +
            '          inbox!(["chatAdmin", channel, {"pub": *pub, "sub": *sub, "isend": *isend }], *return) |\n' +
            '          inbox!(["chat", channel, {"listener": *listener }], *return) |\n' +
            "          sub!(*listener)\n" +
            "        }\n" +
            "      }\n" +
            "    }\n" +
            "  }\n" +
            "}",
        fields: [str_field("channel")]
    },
    sendChat: {
        code:
            "[channel, message] => {\n" +
            "  new\n" +
            "  return(`rho:rchain:deployId`),\n" +
            "  deployerId(`rho:rchain:deployerId`),\n" +
            "  stdout(`rho:io:stdout`),\n" +
            "  ch\n" +
            "  in {\n" +
            '    for(@{"peek": *peek, ..._} <<- @[*deployerId, "inbox"]) {\n' +
            '      return!("retrun one") |\n' +
            '      peek!("chatAdmin", channel, *ch) |\n' +
            '      for (@[{"pub": pub, ..._}] <- ch) {\n' +
            '        return!("return two") |\n' +
            "        @pub!(message, *ch) |\n" +
            "        for (_ <- ch) {\n" +
            '          return!("Chat sent!")\n' +
            "        }\n" +
            "      }\n" +
            "    }\n" +
            "  }\n" +
            "}",
        fields: [str_field("channel"), str_field("message")]
    },
    readChat: {
        code:
            "[channel] => {\n" +
            "  new\n" +
            "  return(`rho:rchain:deployId`),\n" +
            "  deployerId(`rho:rchain:deployerId`),\n" +
            "  ch\n" +
            "  in {\n" +
            '    for(@{"peek": *peek, ..._} <<- @[*deployerId, "inbox"]) {\n' +
            '      peek!("chat", channel, *ch) |\n' +
            '      for (@[{"listener": *listener}] <- ch) {\n' +
            "        for(value, ack <- listener) {\n" +
            '          return!("message: \\n" ++ *value) |\n' +
            "          ack!(Nil)\n" +
            "        }\n" +
            "      }\n" +
            "    }\n" +
            "  }\n" +
            "}",
        fields: [str_field("channel")]
    },
    newBallot: {
        code:
            "[lockerTag, name, ballot] => {\n" +
            "  new\n" +
            "  trace,\n" +
            "  lookupCh,\n" +
            "  bCh,\n" +
            "  ch1,\n" +
            "  lookup(`rho:registry:lookup`),\n" +
            "  return(`rho:rchain:deployId`),\n" +
            "  deployerId(`rho:rchain:deployerId`)\n" +
            "  in {\n" +
            '    for (@{"read": *MCA, ..._} <<- @[*deployerId, "dictionary"]) {\n' +
            '      return!(["MCA", *MCA]) |\n' +
            '      MCA!("Ballot", *lookupCh)\n' +
            "    } |\n" +
            "    for(Ballot <- lookupCh) {\n" +
            '      return!(["Ballot", *Ballot]) |\n' +
            "      Ballot!(ballot, *bCh, *return) |\n" +
            "      for(admin, tally <- bCh) {\n" +
            '        return!(["bCh", *admin, *tally]) |\n' +
            '        for (@{"inbox": *inbox, "URI": uri ..._} <<- @[*deployerId, lockerTag]) {\n' +
            '          return!(["Ballot", name, {"admin": *admin, "tally": *tally}]) |\n' +
            '          inbox!(["Ballot", name, {"admin": *admin, "tally": *tally}], *return) |\n' +
            '          admin!("giveRightToVote", uri, *ch1, *return) |\n' +
            "          for (voterCap <- ch1) {\n" +
            '            inbox!(["voter", name, {"voterCap": *voterCap, "tally": *tally}], *return)\n' +
            "          }\n" +
            "        }\n" +
            "      }\n" +
            "    }\n" +
            "  }\n" +
            "}",
        fields: [str_field("lockerTag"), str_field("name"), num_field("ballot")]
    },
    castBallot: {
        code:
            "[lockerTag, ballot, choices] => {\n" +
            "  new\n" +
            "  return(`rho:rchain:deployId`),\n" +
            "  deployerId(`rho:rchain:deployerId`),\n" +
            "  stdout(`rho:io:stdout`),\n" +
            "  ch\n" +
            "  in {\n" +
            '    for(@{"peek": *peek, ..._} <<- @[*deployerId, lockerTag]) {\n' +
            '      peek!("voter", ballot, *ch) |\n' +
            '      for (@[{"voterCap": voterCapability, ..._}] <- ch) {\n' +
            '        if ( choices == "" ) {\n' +
            '          @voterCapability!("vote", Nil, *return, *stdout)\n' +
            "        } else {\n" +
            '          @voterCapability!("vote", choices, *return, *stdout)\n' +
            "        }\n" +
            "      }\n" +
            "    }\n" +
            "  }\n" +
            "}",
        fields: [str_field("lockerTag"), str_field("ballot"), num_field("choices")]
    },
    newIssue: {
        code:
            "[lockerTag, name, proposals] => {\n" +
            "  new\n" +
            "  trace,\n" +
            "  lookupCh,\n" +
            "  bCh,\n" +
            "  ch1,\n" +
            "  lookup(`rho:registry:lookup`),\n" +
            "  return(`rho:rchain:deployId`),\n" +
            "  deployerId(`rho:rchain:deployerId`)\n" +
            "  in {\n" +
            '    for (@{"read": *MCA, ..._} <<- @[*deployerId, "dictionary"]) {\n' +
            '      return!(["MCA", *MCA]) |\n' +
            '      MCA!("Issue", *lookupCh)\n' +
            "    } |\n" +
            "    for(Issue <- lookupCh) {\n" +
            '      return!(["Issue", *Issue]) |\n' +
            "      Issue!(proposals, *bCh, *return) |\n" +
            "      for(admin, tally <- bCh) {\n" +
            '        return!(["bCh", *admin, *tally]) |\n' +
            '        for (@{"inbox": *inbox, "URI": uri ..._} <<- @[*deployerId, lockerTag]) {\n' +
            '          return!(["issue", name, {"admin": *admin, "tally": *tally}]) |\n' +
            '          inbox!(["issue", name, {"admin": *admin, "tally": *tally}], *return) |\n' +
            '          admin!("giveRightToVote", uri, *ch1, *return) |\n' +
            "          for (voterCap <- ch1) {\n" +
            '            inbox!(["vote", name, {"voterCap": *voterCap}], *return)\n' +
            "          }\n" +
            "        }\n" +
            "      }\n" +
            "    }\n" +
            "  }\n" +
            "}",
        fields: [str_field("lockerTag"), str_field("name"), set_field("proposals")]
    },
    addVoterToIssue: {
        code:
            "[lockerTag, toInboxURI, issue] => {\n" +
            "  new\n" +
            "  return(`rho:rchain:deployId`),\n" +
            "  deployerId(`rho:rchain:deployerId`),\n" +
            "  inboxLookup(`rho:registry:lookup`),\n" +
            "  stdout(`rho:io:stdout`),\n" +
            "  ch,\n" +
            "  ch1,\n" +
            "  inboxCh\n" +
            "  in {\n" +
            '    for (@{ "peek": *peek, ..._ } <<- @[*deployerId, lockerTag]) {\n' +
            '      stdout!(["peek", *peek]) |\n' +
            '      peek!("issue", issue, *ch) |\n' +
            '      for (@[{ "admin": *admin, "tally": *tally, ..._ }] <- ch) {\n' +
            '        stdout!(["admin", *admin]) |\n' +
            '        admin!("giveRightToVote", toInboxURI, *ch1, *return) |\n' +
            "        for (voterCap <- ch1) {\n" +
            '          stdout!(["voterCap", *voterCap]) |\n' +
            "          inboxLookup!(toInboxURI, *inboxCh) |\n" +
            "          for (inbox <- inboxCh) {\n" +
            '            stdout!(["inbox", *inbox]) |\n' +
            '            inbox!(["vote", issue, {"voterCap": *voterCap}], *return) |\n' +
            '            inbox!(["issue", issue, {"tally": *tally}], *stdout)\n' +
            "          }\n" +
            "        }\n" +
            "      }\n" +
            "    }\n" +
            "  }\n" +
            "}",
        fields: [str_field("lockerTag"), uri_field("toInboxURI"), str_field("issue")]
    },
    addGroupToIssue: {
        code:
            "[lockerTag, group, issue] => {\n" +
            "  new\n" +
            "  stdout(`rho:io:stdout`),\n" +
            "  deployId(`rho:rchain:deployId`),\n" +
            "  deployerId(`rho:rchain:deployerId`),\n" +
            "  ch\n" +
            "  in {\n" +
            '    for(@{"peek": *peek, "URI": uri ..._} <<- @[*deployerId, lockerTag]) {\n' +
            '      deployId!({"URI": uri}) |\n' +
            "      new lockerCh, ret, ret1, ret2, ret3, loop in {\n" +
            '        peek!("Group", group, *ret) |\n' +
            '        peek!("issue", issue, *ret1) |\n' +
            '        for ( @[{"read": *read, ..._}, ..._] <- ret;  @[{"admin": *admin, ..._}, ..._] <- ret1 ) {\n' +
            '          stdout!(["adding users") |\n' +
            "          contract loop ( @map ) = {\n" +
            "            match  map {\n" +
            "              {} => Nil\n" +
            '              {  username: {"inbox": *inbox, "delegate": delegate, ..._}, ...tail } => {\n' +
            '                stdout!(["user",username]) |\n' +
            '                admin!("giveRightToVote", username, *ret2) |\n' +
            "                for (@vote <- ret2) {\n" +
            '                  stdout!([username, "added"]) |\n' +
            '                  inbox!(["vote", issue, vote], *stdout) |\n' +
            '                  @vote!("delegate",delegate, *stdout)\n' +
            "                }|\n" +
            "                loop!(tail)\n" +
            "              }\n" +
            '              somethingelse => stdout!(["somethingelse", somethingelse])\n' +
            "            }\n" +
            "          }|\n" +
            "          read!(*ret3) |\n" +
            "          for ( @members <- ret3 ) {\n" +
            '            stdout!(["keys",members.keys()]) |\n' +
            "            loop!(members)\n" +
            "          }\n" +
            "        }\n" +
            "      }\n" +
            "    }\n" +
            "  }\n" +
            "}",
        fields: [str_field("lockerTag"), str_field("group"), str_field("issue")]
    },
    castVote: {
        code:
            "[lockerTag, issue, theVote] => {\n" +
            "  new\n" +
            "  return(`rho:rchain:deployId`),\n" +
            "  deployerId(`rho:rchain:deployerId`),\n" +
            "  stdout(`rho:io:stdout`),\n" +
            "  ch\n" +
            "  in {\n" +
            '    for(@{"peek": *peek, ..._} <<- @[*deployerId, lockerTag]) {\n' +
            '      peek!("vote", issue, *ch) |\n' +
            '      for (@[{"voterCap": voterCapability}] <- ch) {\n' +
            '        if ( theVote == "" ) {\n' +
            '          @voterCapability!("vote", Nil, *return, *stdout)\n' +
            "        } else {\n" +
            '          @voterCapability!("vote", theVote, *return, *stdout)\n' +
            "        }\n" +
            "      }\n" +
            "    }\n" +
            "  }\n" +
            "}",
        fields: [str_field("lockerTag"), str_field("issue"), str_field("theVote")]
    },
    displayVote: {
        code:
            "[lockerTag, issue] => {\n" +
            "  new\n" +
            "  return(`rho:rchain:deployId`),\n" +
            "  deployerId(`rho:rchain:deployerId`),\n" +
            "  ch\n" +
            "  in {\n" +
            '    for(@{"peek": *peek, ..._} <<- @[*deployerId, lockerTag]) {\n' +
            '      peek!("vote", issue, *ch) |\n' +
            '      for (@[{"voterCap": voterCapability}] <- ch) {\n' +
            '        @voterCapability!("choice", Set(), *return, *return)\n' +
            "      }\n" +
            "    }\n" +
            "  }\n" +
            "}",
        fields: [str_field("lockerTag"), str_field("issue")]
    },
    delegateVote: {
        code:
            "[lockerTag, issue, delegateURI] => {\n" +
            "  new\n" +
            "  return(`rho:rchain:deployId`),\n" +
            "  deployerId(`rho:rchain:deployerId`),\n" +
            "  stdout(`rho:io:stdout`),\n" +
            "  ch\n" +
            "  in {\n" +
            '    for(@{"peek": *peek, ..._} <<- @[*deployerId, lockerTag]) {\n' +
            '      peek!("vote", issue, *ch) |\n' +
            '      for (@[{"voterCap": voterCapability}] <- ch) {\n' +
            '        @voterCapability!("delegate", delegateURI, *stdout, *return)\n' +
            "      }\n" +
            "    }\n" +
            "  }\n" +
            "}",
        fields: [
            str_field("lockerTag"),
            str_field("issue"),
            uri_field("delegateURI")
        ]
    },
    tallyVotes: {
        code:
            "[lockerTag, issue] => {\n" +
            "  new\n" +
            "  return(`rho:rchain:deployId`),\n" +
            "  deployerId(`rho:rchain:deployerId`),\n" +
            "  stdout(`rho:io:stdout`),\n" +
            "  ch\n" +
            "  in {\n" +
            '    for (@{ "peek": *peek, ..._ } <<- @[*deployerId, lockerTag]) {\n' +
            '      peek!("issue", issue, *ch) |\n' +
            '      for (@[{"tally": *tally, ...restOfStuff }] <- ch) {\n' +
            "        tally!(*return, *stdout)\n" +
            "      }\n" +
            "    }\n" +
            "  }\n" +
            "}",
        fields: [str_field("lockerTag"), str_field("issue")]
    },
    share: {
        code:
            "[lockerTag, toInboxURI, type, subtype] => {\n" +
            "  new\n" +
            "  return(`rho:rchain:deployId`),\n" +
            "  deployerId(`rho:rchain:deployerId`),\n" +
            "  inboxLookup(`rho:registry:lookup`),\n" +
            "  stdout(`rho:io:stdout`),\n" +
            "  ch,\n" +
            "  ch1,\n" +
            "  inboxCh\n" +
            "  in {\n" +
            '    for (@{ "peek": *peek, ..._ } <<- @[*deployerId, lockerTag]) {\n' +
            '      stdout!(["peek", *peek]) |\n' +
            "      peek!(type, subtype, *ch) |\n" +
            "      for ( list <- ch) {\n" +
            '        stdout!(["list", *list]) |\n' +
            "        inboxLookup!(toInboxURI, *inboxCh) |\n" +
            "        for (inbox <- inboxCh) {\n" +
            '          stdout!(["inbox", *inbox]) |\n' +
            "          inbox!([type, subtype] ++ *list, *return)\n" +
            "        }\n" +
            "      }\n" +
            "    }\n" +
            "  }\n" +
            "}",
        fields: [
            str_field("lockerTag"),
            uri_field("toInboxURI"),
            str_field("type"),
            str_field("subtype")
        ]
    },
    sendMail: {
        code:
            "[lockerTag, toInboxURI, from, to, sub, body] => {\n" +
            "  new\n" +
            "  deployId(`rho:rchain:deployId`),\n" +
            "  deployerId(`rho:rchain:deployerId`),\n" +
            "  lookup(`rho:registry:lookup`),\n" +
            "  inboxCh\n" +
            "  in {\n" +
            "    lookup!(toInboxURI, *inboxCh) |\n" +
            "    for (toinbox <- inboxCh) {\n" +
            '      toinbox!(["email",from,{"to": to, "sub": sub, "body": body}], *deployId)\n' +
            "    }\n" +
            "  }\n" +
            "}",
        fields: [
            str_field("lockerTag"),
            uri_field("toInboxURI"),
            str_field("from"),
            str_field("to"),
            str_field("sub"),
            str_field("body")
        ]
    },
    newGroup: {
        code:
            "[name, lockerTag] => {\n" +
            "  new\n" +
            "  out,\n" +
            "  deployId(`rho:rchain:deployId`),\n" +
            "  deployerId(`rho:rchain:deployerId`),\n" +
            "  lookup(`rho:registry:lookup`),\n" +
            "  trace(`rho:io:stdout`),\n" +
            "  ret,\n" +
            "  ret2\n" +
            "  in {\n" +
            '    for (@{"read": *MCA, ..._} <<- @[*deployerId, "dictionary"]) {\n' +
            '      trace!({"MCA": *MCA}) |\n' +
            '      MCA!("Group", *ret)\n' +
            "    } |\n" +
            "    for ( Group <- ret) {\n" +
            '      for(@{"inbox": *inbox, ..._} <<- @{[*deployerId, lockerTag]}) {\n' +
            '        Group!("new", name, *inbox, *ret2)|\n' +
            "        for (caps <- ret2) {\n" +
            "          if (*caps != Nil) {\n" +
            '            inbox!(["Group", name, *caps], *deployId)\n' +
            "          } else {\n" +
            '            deployId!("newCommunity \n" ++ name ++ " failed")\n' +
            "          }\n" +
            "        }\n" +
            "      }\n" +
            "    }\n" +
            "  }\n" +
            "}",
        fields: [str_field("name"), str_field("lockerTag")]
    },
    joinGroup: {
        code:
            "[group, userid, lockerTag] => {\n" +
            "  new\n" +
            "  out,\n" +
            "  deployId(`rho:rchain:deployId`),\n" +
            "  deployerId(`rho:rchain:deployerId`),\n" +
            "  lookup(`rho:registry:lookup`),\n" +
            "  stdout(`rho:io:stdout`),\n" +
            "  trace(`rho:io:stdout`),\n" +
            "  ret,\n" +
            "  ret2\n" +
            "  in {\n" +
            '    for (@{"read": *MCA, ..._} <<- @[*deployerId, "dictionary"]) {\n' +
            '      trace!({"MCA": *MCA}) |\n' +
            '      MCA!("Group", *ret) |\n' +
            "      for ( Group <- ret) {\n" +
            '        for(@{"inbox": *inbox, "URI": *URI, ..._} <<- @{[*deployerId, lockerTag]}) {\n' +
            '          Group!("request", group, userid, *URI, *deployerId, *ret, *deployId)|\n' +
            "          for (caps <- ret) {\n" +
            "            if (*caps != Nil) {\n" +
            '              inbox!(["Group", group, *caps], *deployId)\n' +
            "            } else {\n" +
            '              deployId!("community \n" ++ group ++ " failed")\n' +
            "            }\n" +
            "          }\n" +
            "        }\n" +
            "      }\n" +
            "    }\n" +
            "  }\n" +
            "}",
        fields: [str_field("group"), str_field("userid"), str_field("lockerTag")]
    },
    addMember: {
        code:
            "[name, revAddress, themBoxReg, group, lockerTag] => {\n" +
            "  new\n" +
            "  deployId(`rho:rchain:deployId`),\n" +
            "  deployerId(`rho:rchain:deployerId`),\n" +
            "  lookup(`rho:registry:lookup`),\n" +
            "  ret,\n" +
            "  boxCh,\n" +
            "  ack\n" +
            "  in {\n" +
            '    for(@{"peek": *peek, "inbox": *inbox, ..._} <<- @{[*deployerId, lockerTag]}) {\n' +
            "      lookup!(themBoxReg, *boxCh) |\n" +
            '      peek!("Group", group, *ret)|\n' +
            '      for ( @[{"admin": *admin, "read": *read, "write": *write, "grant": *grant}] <- ret; themBox <- boxCh ) {\n' +
            '        //stdout!("adding user")|\n' +
            '        admin!("add user", name, revAddress, themBoxReg, *ret, *deployId) |\n' +
            "        for (selfmod <- ret) {\n" +
            '          //stdout!("user added") |\n' +
            '          themBox!(["member", group, {"read": *read, "selfmod": *selfmod}], *deployId)\n' +
            "        }\n" +
            "      }\n" +
            "    }\n" +
            "  }\n" +
            "}",
        fields: [
            str_field("name"),
            str_field("revAddress"),
            uri_field("themBoxReg"),
            str_field("group"),
            str_field("lockerTag")
        ]
    },
    newMemberDirectory: {
        code:
            "[] => {\n" +
            "  new\n" +
            "  return(`rho:rchain:deployId`),\n" +
            "  lookup(`rho:registry:lookup`),\n" +
            "  regCh\n" +
            "  in {\n" +
            '    for (@{"read": *MCA, ..._} <<- @[*deployerId, "MasterContractAdmin"]) {\n' +
            '      trace!({"MCA": MCA}) |\n' +
            '      MCA("Directory", regCh)\n' +
            "    } |\n" +
            "    for (MemberDirectory <- regCh) {\n" +
            '      for (@{"read": *MCA, ..._} <<- @[*deployerId, "MasterContractAdmin"]) {\n' +
            '        trace!({"MCA": MCA}) |\n' +
            '        MCA("Roll", regCh)\n' +
            "      } |\n" +
            "      for (rollReg <- regCh) {\n" +
            '        MemberDirectory!("makeFromURI", rollReg, *return)\n' +
            "      }\n" +
            "    }\n" +
            "  }\n" +
            "}",
        fields: []
    },
    makeMint: {
        code:
            "[name, lockerTag] => {\n" +
            "  new\n" +
            "  return,\n" +
            "  rl(`rho:registry:lookup`),\n" +
            "  deployerId(`rho:rchain:deployerId`),\n" +
            "  deployId(`rho:rchain:deployId`),\n" +
            "  //MakeMint(`rho:rchain:makeMint`),\n" +
            "  ch\n" +
            "  in {\n" +
            '    for (@{"read": *MCA, ..._} <<- @[*deployerId, "dictionary"]) {\n' +
            '      deployId!({"MCA": *MCA}) |\n' +
            "      rl!(`\n" +
            "      rho:rchain:makeMint`, *ch)\n" +
            "    } |\n" +
            '    // for (MakeMint <- ch) {deployId!([*MakeMint, "MakeMint"] ) |\n' +
            "    for (@(nonce, *MakeMint) <- ch) {\n" +
            '      deployId!(["MakeMint", *MakeMint]) |\n' +
            "      MakeMint!(*ch) |\n" +
            "      for (aMint <- ch) {\n" +
            '        deployId! (["aMint", *aMint]) |\n' +
            '        for (@{"inbox": *inbox, ..._} <<- @{[*deployerId, lockerTag]}) {\n' +
            '          //send the mint to my inbox for safe keeping.//inbox!(["issue", name, {"admin": *admin, "tally": *tally}], *return)\n' +
            '          //inbox!(["issue", name, {"admin": *admin, "tally": *tally}], *return)\n' +
            '          inbox!(["Mint", name, {"admin": *aMint}], *deployId) |\n' +
            '          deployId!("Received to inbox")\n' +
            "        }\n" +
            "      }\n" +
            "    }\n" +
            "  }\n" +
            "}",
        fields: [str_field("name"), str_field("lockerTag")]
    },
    helloWorld: {
        code:
            "[] => {\n" +
            "  new\n" +
            "  channel(`rho:io:stdout`)\n" +
            "  in {\n" +
            '    channel!("Hello")\n' +
            "  }\n" +
            "}",
        fields: []
    },
    getRoll: {
        code:
            "[] => {\n" +
            "  new trace, ret(`rho:rchain:deployId`), deployerId(`rho:rchain:deployerId`), ch, lookup(`rho:registry:lookup`) in {\n" +
            '    for (@{"read": *MCA, ..._} <<- @[*deployerId, "dictionary"]) {\n' +
            '      trace!({"MCA": *MCA}) |\n' +
            '      MCA!("Roll", *ch)\n' +
            "    } |\n" +
            "    for (@set <- ch) {\n" +
            '      ret!(["#define", "$roll", set.toList()])\n' +
            "    }\n" +
            "  }\n" +
            "}",
        fields: []
    },
    peekKudos: {
        code:
            "[] => {\n" +
            "  new\n" +
            "  return,\n" +
            "  lookup(`rho:registry:lookup`), ch\n" +
            "  in {\n" +
            "    lookup!(KudosReg, *ch) | for (Kudos <- ch) {\n" +
            '      Kudos!("peek", *ch) | for (@current <-ch ) {\n' +
            '        return!(["#define", "$kudos", current])\n' +
            "      }\n" +
            "    }\n" +
            "  }\n" +
            "}",
        fields: []
    },
    awardKudos: {
        code:
            "[them] => {\n" +
            "  new\n" +
            "  deployId(`rho:rchain:deployId`),\n" +
            "  lookup(`rho:registry:lookup`),\n" +
            "  ch\n" +
            "  in {\n" +
            "    lookup!(KudosReg, *ch) | for (Kudos <- ch) {\n" +
            '      Kudos!("award", them, *ch) | for (@current <- ch) {\n' +
            '        deployId!(["#define", "$kudos", current])\n' +
            "      }\n" +
            "    }\n" +
            "  }\n" +
            "}",
        fields: [str_field("them")]
    },
    claimWithInbox: {
        code:
            "[myGovRevAddr] => {\n" +
            "  new trace, return, lookup(`rho:registry:lookup`), regCh in {\n" +
            '    for (@{"read": *MCA, ..._} <<- @[*deployerId, "dictionary"]) {\n' +
            '      trace!({"MCA": MCA}) |\n' +
            '      MCA("Directory", regCh)\n' +
            "    } | for (memDir <- regCh) {\n" +
            '      memDir!("setup", myGovRevAddr, *return)\n' +
            "    }\n" +
            "  }\n" +
            "}",
        fields: [rev_field("myGovRevAddr")]
    },
    checkRegistration: {
        code:
            "[myGovRevAddr] => {\n" +
            "  new\n" +
            "  trace,\n" +
            "  return,\n" +
            "  lookup(`rho:registry:lookup`),\n" +
            "  ch\n" +
            "  in\n" +
            "  {\n" +
            '    for (@{"read": *MCA, ..._} <<- @[*deployerId, "dictionary"]) {\n' +
            '      trace!({"MCA": MCA}) |\n' +
            '      MCA("Roll", ch)\n' +
            "    } |\n" +
            "    for (@addrSet <- ch) {\n" +
            '      return!(["#define", "$agm2020voter", addrSet.contains(myGovRevAddr)])\n' +
            "    }\n" +
            "  }\n" +
            "}",
        fields: [rev_field("myGovRevAddr")]
    },
    lookupURI: {
        code:
            "[URI] => {\n" +
            "  new     // always use EXPLORE\n" +
            "  return,\n" +
            "  lookup(`rho:registry:lookup`),\n" +
            "  stdout(`rho:io:stdout`),\n" +
            "  lookupCh\n" +
            "  in {\n" +
            "    lookup!(URI, *lookupCh) |\n" +
            "    for (u <- lookupCh) {\n" +
            '      stdout!([ "URI", URI, "Obj", *u]) |\n' +
            '      return!([ "URI", URI, "Obj", *u])\n' +
            "    }\n" +
            "  }\n" +
            "}",
        fields: [uri_field("URI")]
    },
    createURI: {
        code:
            "[value] => {\n" +
            "  new\n" +
            "  return(`rho:rchain:deployId`),\n" +
            "  insert(`rho:registry:insertArbitrary`),\n" +
            "  stdout(`rho:io:stdout`),\n" +
            "  uriCh\n" +
            "  in {\n" +
            "    insert!(\n" +
            "    value               // enter value above or replace value here with longer rholang\n" +
            "    , *uriCh) |\n" +
            "    for (@URI <- uriCh) {\n" +
            '      stdout!([ "URI", URI, "Obj", value]) |\n' +
            '      return!([ "URI", URI, "Obj", value])\n' +
            "    }\n" +
            "  }\n" +
            "}",
        fields: [num_field("value")]
    },
    doit: {
        code:
            "[lockerTag, type, subtype, capability, method, arg] => {\n" +
            "  new\n" +
            "  //                 type and subtype are optional\n" +
            "  deployId(`rho:rchain:deployId`),\n" +
            "  deployerId(`rho:rchain:deployerId`),\n" +
            "  ch\n" +
            "  in {\n" +
            '    for(@{"peek": *peek, "URI": uri ..._} <<- @[*deployerId, lockerTag]) {\n' +
            '      deployId!({"URI": uri}) |\n' +
            '      if (type == "" ) {\n' +
            "        peek!(*deployId)\n" +
            '      } else if (subtype == "" ) {\n' +
            "        peek!(type,*deployId)\n" +
            "      }  else {\n" +
            "        peek!(type,subtype,*ch)\n" +
            "        for ( @(capability: *cap, ..._) <- ch ) {\n" +
            "          cap!(method,arg,deployId)\n" +
            "        }\n" +
            "      }\n" +
            "    }\n" +
            "  }\n" +
            "}",
        fields: [
            str_field("lockerTag"),
            str_field("type"),
            str_field("subtype"),
            str_field("capability"),
            str_field("method"),
            set_field("arg")
        ]
    },
    towers: {
        code:
            "[height] => {\n" +
            "  new result, stdout(`rho:io:stdout`), move, ack, log, list in {\n" +
            "    // create names/channels needed\n" +
            "    // towers of hanoi - use EXPLORE\n" +
            "    // derived from prolog example https://www.cpp.edu/~jrfisher/www/prolog_tutorial/2_3.html\n" +
            '    // Move a pile of disks of [height] from the "left" peg to the "right" peg\n' +
            '    // using the "center" peg as an intermetiate place to put them.\n' +
            "    // Never put a larger disk on a smaller on.\n" +
            "    // Then write to the ack channel to acknowledge completion\n" +
            '    move!(height,"left","right","center", *ack) |\n' +
            "    contract move(@height, @from, @to, @other, ack) = {\n" +
            "      // create a new ack1 channel to sequence actions within move\n" +
            "      new ack1 in {\n" +
            "        match height {\n" +
            "          1 => { // if the height is 1 move from the @from peg to the @to peg directly\n" +
            '            log!("Move top disk from \n" ++ from ++ " to \n" ++ to, *ack1) |\n' +
            '            stdout!("Move top disk from \n" ++ from ++ " to \n" ++ to) |\n' +
            "            for (_ <- ack1) {ack!(Nil)}\n" +
            "          }\n" +
            "          _ => { // if the height is not one, uncover a larger disk from the @from onto the @other pile\n" +
            "            move!(height-1, from, other, to, *ack1) |\n" +
            "            for ( _ <- ack1 ) { // then move the larger disk to the @to pile\n" +
            "              move!(1, from, to, other, *ack1) |\n" +
            "              for ( _ <- ack1 ) { // then move the smaller [other] on top of the @to\n" +
            "                move!(height-1, other, to, from, *ack1) |\n" +
            "                for ( _ <- ack1 ) {\n" +
            "                  ack!(Nil) // when done return an acknowledgement\n" +
            "                }\n" +
            "              }\n" +
            "            }\n" +
            "          }\n" +
            "        }\n" +
            "      }\n" +
            "    } |\n" +
            "    list!([]) |\n" +
            "    contract log(term, ack) = {\n" +
            "      for ( prior <- list) {\n" +
            "        list!(*prior ++ [*term]) |\n" +
            "        ack!(Nil)\n" +
            "      }\n" +
            "    } |\n" +
            "    for (_ <- ack; alist <- list ) {result!(*alist)}\n" +
            "  }\n" +
            "}",
        fields: [num_field("height")]
    },
} satisfies Record<string, Snippet>;

// Editor help metadata for each snippet: a short description, optional
// per-field help text, and optional default field values (ported from rgov).
export type SnippetMeta = {
    description: string;
    fieldHelp?: Record<string, string>;
    defaults?: Record<string, string>;
};

// Hints shared across many templates (used by the explainer UI).
export const common_field_help: Record<string, string> = {
    lockerTag: "Which inbox \"locker\" to use (defaults to \"inbox\").",
    ReadcapURI: "Master read-capability URI.",
    toInboxURI: "Recipient's inbox URI.",
    delegateURI: "URI to delegate your vote to.",
    amount: "Amount in drops (1 REV = 100,000,000 drops).",
};

// Defaults shared across many templates.
export const common_field_defaults: Record<string, string> = {
    lockerTag: "inbox",
};

export const snippet_meta: Record<keyof typeof snippets, SnippetMeta> = {
    blank: { description: "Empty starting point — write rholang from scratch." },
    checkBalance: { description: "Read the REV balance of a wallet address." },
    transfer: {
        description: "Transfer REV from your wallet to another address.",
        defaults: { amount: "100000000" },
    },
    sequencialLooping: { description: "Demo of sequential looping and recursion in rholang." },
    newInbox: { description: "Claim your dictionary and inbox from the master contract." },
    peekInbox: { description: "Peek at inbox messages (optionally filtered by type/subtype)." },
    receiveFromInbox: { description: "Consume (receive) a message from your inbox." },
    createInboxandCastVote: { description: "Create an inbox and cast a vote (placeholder)." },
    newChat: { description: "Create a chat channel with pub/sub capabilities." },
    sendChat: { description: "Send a message to a chat channel." },
    readChat: { description: "Read the next message from a chat channel." },
    newBallot: { description: "Create a ballot and grant voting rights." },
    castBallot: { description: "Cast a vote on a ballot." },
    newIssue: { description: "Create an issue with a set of proposals." },
    addVoterToIssue: { description: "Grant a voter the right to vote on an issue." },
    addGroupToIssue: { description: "Grant every member of a group the right to vote on an issue." },
    castVote: { description: "Cast a vote on an issue." },
    displayVote: { description: "Show the current vote choices on an issue." },
    delegateVote: { description: "Delegate your vote on an issue to another inbox." },
    tallyVotes: { description: "Tally the votes on an issue." },
    share: { description: "Share an object from your inbox to another inbox." },
    sendMail: { description: "Send an email-style message to another inbox." },
    newGroup: { description: "Create a new group/community." },
    joinGroup: { description: "Request to join a group." },
    addMember: { description: "Add a member to a group." },
    newMemberDirectory: { description: "Create a new member directory." },
    makeMint: {
        description: "Create a new token mint.",
        defaults: { name: "myTokenMint" },
    },
    helloWorld: { description: "Minimal hello-world — write to stdout." },
    getRoll: { description: "Read the membership roll (registered voters)." },
    peekKudos: { description: "Peek at the current kudos value." },
    awardKudos: { description: "Award kudos to someone." },
    claimWithInbox: { description: "Set up your inbox via the member directory." },
    checkRegistration: { description: "Check whether an address is registered on the roll." },
    lookupURI: { description: "Look up the object registered at a URI." },
    createURI: { description: "Insert an arbitrary value into the registry and get its URI." },
    doit: {
        description: "Generic capability call — invoke a method on a capability.",
        defaults: { type: "Group", capability: "admin", method: "register" },
    },
    towers: {
        description: "Towers of Hanoi recursion demo.",
        defaults: { height: "3" },
    },
};

